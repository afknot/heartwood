import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, filesDir } from '../config.js';
import { db, newId, now, listPeople, ftsQuery, safeJson, getSettings } from '../db.js';
import { complete } from '../llm.js';
import { buildAsk, citedSources, getAttachments } from '../ask.js';
import { extractFile, ACCEPTED_EXT } from '../files.js';
import { transcribeFile } from '../transcribe.js';
import { listSchedules } from '../schedules.js';
import { meetingSeries } from '../calendar.js';
import { createPersonBrief, createGrowth, latestGrowth, createPeriodReport, BriefError } from '../briefs.js';

export const ai = express.Router();

// ---------- Reports ----------
ai.get('/reports', (req, res) => {
  const { person } = req.query;
  const rows = person
    ? db.prepare('SELECT id, kind, person_id, title, range_from, range_to, focus, entry_count, created_at FROM reports WHERE person_id = ? AND kind = \'person\' ORDER BY created_at DESC').all(person)
    : db.prepare(`SELECT id, kind, person_id, title, range_from, range_to, focus, entry_count, created_at FROM reports WHERE kind = 'period' ORDER BY created_at DESC LIMIT 100`).all();
  res.json(rows);
});

ai.get('/reports/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

ai.delete('/reports/:id', (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

ai.post('/reports', async (req, res, next) => {
  try {
    const { from, to, focus = '' } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'Pick a date range.' });
    // The phone sends its own local-day boundaries; fall back to server time.
    const valid = s => typeof s === 'string' && !isNaN(Date.parse(s));
    const fromIso = valid(req.body.from_iso) ? new Date(req.body.from_iso).toISOString() : new Date(from + 'T00:00:00').toISOString();
    const toIso = valid(req.body.to_iso) ? new Date(req.body.to_iso).toISOString() : new Date(to + 'T23:59:59.999').toISOString();
    res.status(201).json(await createPeriodReport({ fromIso, toIso, from, to, focus: String(focus).slice(0, 500) }));
  } catch (err) {
    if (err instanceof BriefError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Growth record: goals, wins, concerns, feedback and milestones over time, with a review draft.
ai.get('/people/:id/growth', (req, res) => res.json(latestGrowth(req.params.id)));
ai.post('/people/:id/growth', async (req, res, next) => {
  try { res.status(201).json(await createGrowth(req.params.id)); }
  catch (err) {
    if (err instanceof BriefError) return res.status(err.message === 'Not found' ? 404 : 400).json({ error: err.message });
    next(err);
  }
});

ai.post('/people/:id/brief', async (req, res, next) => {
  try {
    res.status(201).json(await createPersonBrief(req.params.id));
  } catch (err) {
    if (err instanceof BriefError) return res.status(err.message === 'Not found' ? 404 : 400).json({ error: err.message });
    next(err);
  }
});

// ---------- Ask your journal (with saved chats) ----------
const chatRow = id => db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
const chatOut = c => c && ({ ...c, archived: !!c.archived, messages: safeJson(c.messages, []) });

ai.get('/chats', (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  // ?subject_kind=person&subject_id=… lists the chats about one person, note or meeting.
  const sk = ['person', 'entry', 'meeting'].includes(req.query.subject_kind) ? req.query.subject_kind : null;
  const rows = sk
    ? db.prepare(`SELECT id, title, archived, subject_kind, subject_id, created_at, updated_at, json_array_length(messages) AS count FROM chats WHERE subject_kind = ? AND subject_id = ? ORDER BY updated_at DESC LIMIT 50`).all(sk, String(req.query.subject_id || ''))
    : db.prepare(`SELECT id, title, archived, subject_kind, subject_id, created_at, updated_at, json_array_length(messages) AS count FROM chats WHERE archived = ? ORDER BY updated_at DESC LIMIT 200`).all(archived);
  res.json(rows.map(r => ({ ...r, archived: !!r.archived })));
});

ai.get('/chats/:id', (req, res) => {
  const c = chatRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(chatOut(c));
});

ai.patch('/chats/:id', (req, res) => {
  const c = chatRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE chats SET title = ?, archived = ? WHERE id = ?').run(
    typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 120) : c.title,
    typeof b.archived === 'boolean' ? (b.archived ? 1 : 0) : c.archived,
    c.id
  );
  res.json(chatOut(chatRow(c.id)));
});

ai.delete('/chats/:id', (req, res) => {
  db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id);
  dropAttachments(db.prepare('SELECT id, stored FROM ask_attachments WHERE chat_id = ?').all(req.params.id));
  res.json({ ok: true });
});

ai.post('/ask', async (req, res, next) => {
  try {
    const question = String(req.body?.question || '').trim();
    const attachIds = (Array.isArray(req.body?.attachments) ? req.body.attachments : []).map(String).slice(0, 10);
    const attachments = getAttachments(attachIds);
    if (!question && !attachments.length) return res.status(400).json({ error: 'Ask a question.' });
    const refs = (Array.isArray(req.body?.refs) ? req.body.refs : [])
      .filter(r => r && ['person', 'entry', 'schedule', 'meeting'].includes(r.type) && typeof r.id === 'string').slice(0, 12)
      .map(r => ({ type: r.type, id: r.id, label: String(r.label || '').slice(0, 120) }));
    let chat = req.body.chat_id ? chatRow(req.body.chat_id) : null;
    const history = chat ? safeJson(chat.messages, []) : [];
    const asked = question || 'What do you make of this?';

    const { system, messages, sources } = buildAsk({ question: asked, history, refs, attachments });
    const answer = await complete({ system, messages, maxTokens: 4000 });
    const cited = citedSources(answer, sources);

    // Save the conversation.
    const t = now();
    const files = attachments.map(a => ({ id: a.id, name: a.name, kind: a.kind }));
    const userMsg = { role: 'user', content: asked, at: t, ...(refs.length ? { refs } : {}), ...(files.length ? { attachments: files } : {}) };
    const saved = [...history, userMsg, { role: 'assistant', content: answer, sources: cited, at: t }];
    if (!chat) {
      const id = newId();
      const title = (question || `About ${attachments[0]?.name || 'a file'}`).replace(/\s+/g, ' ').slice(0, 80);
      // Asked from a person, note or meeting: the chat stays with it.
      const sub = req.body?.subject;
      const sk = sub && ['person', 'entry', 'meeting'].includes(sub.kind) && typeof sub.id === 'string' ? sub : null;
      db.prepare('INSERT INTO chats(id, title, messages, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, title, JSON.stringify(saved), sk?.kind || null, sk ? sk.id.slice(0, 300) : null, t, t);
      chat = chatRow(id);
    } else {
      db.prepare('UPDATE chats SET messages = ?, archived = 0, updated_at = ? WHERE id = ?').run(JSON.stringify(saved), t, chat.id);
    }
    if (attachIds.length) db.prepare(`UPDATE ask_attachments SET chat_id = ? WHERE id IN (${attachIds.map(() => '?').join(',')})`).run(chat.id, ...attachIds);
    res.json({ chat_id: chat.id, title: chat.title, answer, sources: cited });
  } catch (err) { next(err); }
});

// Files and photos for a question: read now (text extracted, photos prepared for the AI), kept with the chat.
const askUpload = multer({
  storage: multer.diskStorage({ destination: tmpDir, filename: (req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname || '').toLowerCase()}`) }),
  limits: { fileSize: 30 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED_EXT.includes(path.extname(file.originalname || '').toLowerCase()))
});
ai.post('/ask/attachments', askUpload.array('files', 8), async (req, res, next) => {
  try {
    const list = req.files || [];
    if (!list.length) return res.status(400).json({ error: `That file type isn’t supported. Try ${ACCEPTED_EXT.join(', ')}.` });
    // Files picked but never sent get cleared out after a couple of days.
    dropAttachments(db.prepare('SELECT id, stored FROM ask_attachments WHERE chat_id IS NULL AND created_at < ?').all(new Date(Date.now() - 2 * 864e5).toISOString()));
    const out = [];
    for (const f of list) {
      try {
        const x = await extractFile(f.path, f.originalname);
        if (!x.text.trim() && !x.images.length) throw new Error('Nothing readable in this file.');
        const id = newId();
        // Keep the original with the other files, so an update saved as a note can carry it.
        const stored = path.basename(f.path);
        await fs.promises.rename(f.path, path.join(filesDir, stored)).catch(() => fs.promises.copyFile(f.path, path.join(filesDir, stored)));
        db.prepare('INSERT INTO ask_attachments(id, name, kind, size, text, images, stored, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, f.originalname.slice(0, 200), x.kind, f.size, x.text, JSON.stringify(x.images), stored, f.mimetype || '', now());
        out.push({ id, name: f.originalname, kind: x.kind, size: f.size, chars: x.text.length, pages: x.images.length });
      } catch (e) {
        out.push({ name: f.originalname, error: e.message.slice(0, 200) });
      } finally {
        fs.rm(f.path, { force: true }, () => {});
      }
    }
    res.status(201).json(out);
  } catch (err) { next(err); }
});
ai.delete('/ask/attachments/:id', (req, res) => {
  dropAttachments(db.prepare('SELECT id, stored FROM ask_attachments WHERE id = ? AND chat_id IS NULL').all(req.params.id));
  res.json({ ok: true });
});

/** Forget attachments, removing each original unless a note now uses it. */
export function dropAttachments(rows) {
  const used = db.prepare('SELECT 1 FROM entry_files WHERE stored = ?');
  for (const r of rows) {
    db.prepare('DELETE FROM ask_attachments WHERE id = ?').run(r.id);
    if (r.stored && !used.get(r.stored)) fs.rm(path.join(filesDir, path.basename(r.stored)), { force: true }, () => {});
  }
}

// Say your question instead of typing it: transcribe a short clip with the engine chosen in Settings.
const voiceUpload = multer({
  storage: multer.diskStorage({ destination: tmpDir, filename: (req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname || '.webm').toLowerCase()}`) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }
});
ai.post('/ask/dictate', voiceUpload.single('audio'), async (req, res) => {
  const file = req.file?.path;
  try {
    if (!file) return res.status(400).json({ error: 'No audio received.' });
    const hint = listPeople().map(p => p.name).join(', ').slice(0, 600);
    const text = await transcribeFile(file, { hint, kind: 'memo', workId: newId() });
    res.json({ text: text.trim() });
  } catch (err) {
    res.status(502).json({ error: `Couldn’t transcribe that: ${err.message}`.slice(0, 300) });
  } finally {
    if (file) fs.rm(file, { force: true }, () => {});
  }
});

// What @ can point at: people, recurring meetings and notes matching what you typed.
ai.get('/ask/suggest', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const people = listPeople();
  const match = t => !q || String(t || '').toLowerCase().includes(q);
  const ppl = people.filter(p => match(p.name) || match(p.role))
    .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? -1 : 0) - (b.name.toLowerCase().startsWith(q) ? -1 : 0))
    .slice(0, 5).map(p => ({ type: 'person', id: p.id, label: p.name, sub: p.role || '', photo: p.photo || null }));
  const sch = listSchedules(people).filter(s => s.active && (match(s.display_title) || s.people.some(p => match(p.name))))
    .slice(0, 3).map(s => ({ type: 'schedule', id: s.id, label: s.display_title, sub: s.next[0] ? s.next[0].start.slice(0, 10) : 'Recurring' }));
  const mtg = meetingSeries({ people, myName: getSettings().profile?.name })
    .filter(m => (m.next || m.last) && (match(m.title) || m.people.some(p => match(p.name))))
    .slice(0, q ? 5 : 4).map(m => ({ type: 'meeting', id: m.uid, label: m.title,
      sub: [m.cadence || (m.recurring ? 'Recurring' : ''), m.next ? `next ${m.next.slice(0, 10)}` : ''].filter(Boolean).join(' · ') }));
  let notes = [];
  const fq = q.length >= 2 ? ftsQuery(q) : null;
  try {
    notes = (fq
      ? db.prepare(`SELECT e.id, e.title, e.created_at FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY bm25(entries_fts) LIMIT 6`).all(fq)
      : db.prepare('SELECT id, title, created_at FROM entries ORDER BY created_at DESC LIMIT 5').all())
      .map(e => ({ type: 'entry', id: e.id, label: e.title || 'Untitled note', sub: e.created_at.slice(0, 10) }));
  } catch { /* odd query syntax */ }
  res.json([...ppl, ...mtg, ...sch, ...notes]);
});
