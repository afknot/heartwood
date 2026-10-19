import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, newId, now, safeJson, setEntryPeople } from '../db.js';
import { extractText, splitByDates, hashText, ACCEPTED, DocError } from '../documents.js';
import { queueImport, synthesizeImported, enqueue } from '../jobs.js';

export const imports = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED.includes(path.extname(file.originalname || '').toLowerCase()))
});

const MAX_SEGMENT_CHARS = 40000;

function preview(row) {
  const segments = safeJson(row.segments, []);
  return {
    id: row.id, person_id: row.person_id, file_name: row.file_name, status: row.status, created_at: row.created_at,
    segments: segments.map((s, index) => ({
      index, date: s.date, heading: s.heading, chars: s.text.length, duplicate: s.duplicate,
      preview: s.text.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)
    }))
  };
}

// 1. Upload a file (or pasted text) → extract, split, return a preview. Nothing is sent to AI yet.
imports.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const personId = req.body.person_id || null;
    if (personId && !db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId)) return res.status(400).json({ error: 'Pick who these 1:1s are with.' });
    let text, fileName;
    if (req.file) {
      fileName = req.file.originalname;
      text = await extractText(req.file.buffer, fileName);
    } else if (req.body.text?.trim()) {
      fileName = 'Pasted text';
      text = String(req.body.text).replace(/\r\n?/g, '\n').trim();
    } else {
      return res.status(400).json({ error: `Choose a file (${ACCEPTED.join(', ')}) or paste some text.` });
    }
    if (!text.trim()) return res.status(400).json({ error: 'That document has no readable text.' });

    const asOne = req.body.mode === 'single';
    let segments = asOne ? [{ date: null, heading: '', text }] : splitByDates(text);
    const seen = db.prepare(`SELECT 1 FROM entries WHERE source_hash LIKE '%' || ? || '%' LIMIT 1`);
    segments = segments.map(s => {
      const h = hashText(s.text);
      return { ...s, text: s.text.slice(0, MAX_SEGMENT_CHARS), hash: h, duplicate: !!seen.get(h) };
    });

    // Drop stale previews.
    db.prepare(`DELETE FROM imports WHERE status = 'preview' AND created_at < ?`).run(new Date(Date.now() - 864e5).toISOString());
    const id = newId();
    db.prepare(`INSERT INTO imports(id, person_id, file_name, file_hash, segments, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, personId, fileName, hashText(text), JSON.stringify(segments), now());
    res.status(201).json(preview(db.prepare('SELECT * FROM imports WHERE id = ?').get(id)));
  } catch (err) {
    if (err instanceof DocError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

imports.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM imports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const out = preview(row);
  const ids = safeJson(row.entry_ids, []);
  if (ids.length) {
    const st = db.prepare(`SELECT status, COUNT(*) n FROM entries WHERE id IN (${ids.map(() => '?').join(',')}) GROUP BY status`).all(...ids);
    const by = Object.fromEntries(st.map(r => [r.status, r.n]));
    out.progress = { total: ids.length, done: (by.ready || 0), failed: (by.error || 0), pending: (by.analyzing || 0) };
  }
  out.entry_ids = ids;
  res.json(out);
});

// 2. Commit the reviewed plan: [{ index, include, merge, date }] → create entries and queue synthesis.
imports.post('/:id/commit', (req, res) => {
  const row = db.prepare('SELECT * FROM imports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'preview') return res.status(409).json({ error: 'This import was already saved.' });
  const segments = safeJson(row.segments, []);
  const plan = new Map((req.body?.segments || []).map(p => [Number(p.index), p]));
  const personId = req.body?.person_id || row.person_id;

  // Apply merges ("join with the one above") in document order.
  const groups = [];
  segments.forEach((s, i) => {
    const p = plan.get(i) || {};
    if (p.include === false) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : s.date;
    if (p.merge && groups.length) {
      const g = groups.at(-1);
      g.text += `\n\n${s.heading ? `**${s.heading}**\n` : ''}${s.text}`;
      g.hashes.push(s.hash);
    } else groups.push({ date, heading: s.heading, text: s.text, hashes: [s.hash] });
  });
  if (!groups.length) return res.status(400).json({ error: 'Nothing selected to import.' });

  const t = now();
  const ins = db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, status, source, source_name, source_text, source_hash, created_at, updated_at)
    VALUES (?, ?, 'one_on_one', '', '["imported"]', 'analyzing', 'import', ?, ?, ?, ?, ?)`);
  const ids = [];
  db.transaction(() => {
    for (const g of groups) {
      const id = newId();
      // Noon local-ish keeps the calendar day stable across time zones.
      const created = g.date ? `${g.date}T16:00:00.000Z` : row.created_at;
      ins.run(id, g.heading && g.heading !== 'Before the first dated section' ? g.heading.slice(0, 120) : '', row.file_name, g.text, g.hashes.join(','), created, t);
      if (personId) setEntryPeople(id, [personId]);
      ids.push(id);
    }
    db.prepare(`UPDATE imports SET status = 'committed', person_id = ?, entry_ids = ? WHERE id = ?`).run(personId, JSON.stringify(ids), row.id);
    if (row.file_hash.startsWith('file:')) db.prepare('UPDATE entry_files SET split_done = 1 WHERE id = ?').run(row.file_hash.slice(5));
  })();
  queueImport(ids, personId);
  res.status(202).json({ id: row.id, entry_ids: ids });
});

// Retry the synthesis for one imported entry.
export function retrySynthesis(req, res) {
  const r = db.prepare(`SELECT id, source FROM entries WHERE id = ?`).get(req.params.id);
  if (!r || r.source !== 'import') return res.status(400).json({ error: 'Not an imported entry.' });
  db.prepare(`UPDATE entries SET status = 'analyzing', error = NULL WHERE id = ?`).run(r.id);
  enqueue(`imp:${r.id}`, () => synthesizeImported(r.id));
  res.status(202).json({ ok: true });
}
