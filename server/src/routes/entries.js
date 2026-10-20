import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, audioDir, filesDir } from '../config.js';
import { db, newId, now, hydrateEntry, getEntryRow, updateEntry, setEntryPeople, ftsQuery, linkMentions } from '../db.js';
import { enqueue, processRecording, analyzeEntry } from '../jobs.js';

export const entries = express.Router();

const KINDS = ['note', 'memo', 'conversation', 'one_on_one', 'meeting'];
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/webm': 'webm', 'video/mp4': 'm4a' };

const upload = multer({
  storage: multer.diskStorage({
    destination: audioDir,
    filename: (req, file, cb) => {
      const base = (file.mimetype || '').split(';')[0];
      cb(null, `${newId()}.${EXT[base] || 'bin'}`);
    }
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(audio|video)\//.test(file.mimetype || ''))
});

function cleanTags(tags) {
  return Array.isArray(tags) ? [...new Set(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 20) : undefined;
}

// List & search
entries.get('/', (req, res) => {
  const { q, person, tag, kind } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = [];
  const args = [];
  let from = 'entries e';
  let order = 'e.created_at DESC';
  if (q && ftsQuery(q)) {
    from = 'entries_fts f JOIN entries e ON e.rowid = f.rowid';
    where.push('entries_fts MATCH ?');
    args.push(ftsQuery(q));
    order = 'bm25(entries_fts), e.created_at DESC';
  }
  if (person) { where.push('EXISTS (SELECT 1 FROM entry_people ep WHERE ep.entry_id = e.id AND ep.person_id = ?)'); args.push(person); }
  if (tag) { where.push('EXISTS (SELECT 1 FROM json_each(e.tags) WHERE json_each.value = ?)'); args.push(tag); }
  if (kind) { where.push('e.kind = ?'); args.push(kind); }
  if (req.query.before) { where.push('e.created_at < ?'); args.push(req.query.before); }
  const sql = `SELECT e.* FROM ${from} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`;
  const rows = db.prepare(sql).all(...args, limit);
  res.json(rows.map(r => {
    const e = hydrateEntry(r);
    // Keep the list light
    e.preview = (e.analysis?.summary || e.body_md || e.transcript || '').replace(/\[@([^\]]+)\]\(\/people\/[0-9a-f-]{36}\)/g, '@$1').replace(/[#*_>`\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
    e.file_count = e.files?.length || 0;
    delete e.files; delete e.body_md; delete e.transcript; delete e.analysis; delete e.source_text; delete e.source_hash;
    return e;
  }));
});

entries.get('/tags', (req, res) => {
  res.json(db.prepare(`SELECT value AS tag, COUNT(*) AS n FROM entries, json_each(entries.tags) GROUP BY value ORDER BY n DESC, value LIMIT 100`).all());
});

entries.post('/', (req, res) => {
  const b = req.body || {};
  const id = newId();
  const t = now();
  db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(b.title || ''), KINDS.includes(b.kind) ? b.kind : 'note', String(b.body_md || ''), JSON.stringify(cleanTags(b.tags) || []), t, t);
  if (Array.isArray(b.people)) setEntryPeople(id, b.people);
  linkMentions(id, b.body_md);
  res.status(201).json(hydrateEntry(getEntryRow(id)));
});

// One-shot upload: creates the entry and starts transcription. Used by the recorder (and its offline retry queue).
entries.post('/recording', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio received.' });
  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch {}
  // Idempotency: the client retries uploads; don't create duplicates.
  if (meta.client_id) {
    const dup = db.prepare(`SELECT id FROM entries WHERE id = ?`).get(meta.client_id);
    if (dup) { fs.rmSync(req.file.path, { force: true }); return res.json(hydrateEntry(getEntryRow(dup.id))); }
  }
  const kind = KINDS.includes(meta.kind) && meta.kind !== 'note' ? meta.kind : 'memo';
  if (kind !== 'memo' && !meta.consent_confirmed) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Consent was not confirmed for this recording.' });
  }
  const id = meta.client_id && /^[0-9a-f-]{36}$/.test(meta.client_id) ? meta.client_id : newId();
  const created = meta.recorded_at && !isNaN(Date.parse(meta.recorded_at)) ? new Date(meta.recorded_at).toISOString() : now();
  db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, audio_file, audio_mime, audio_seconds, status, consent_confirmed, created_at, updated_at)
    VALUES (?, ?, ?, '', '[]', ?, ?, ?, 'transcribing', ?, ?, ?)`)
    .run(id, String(meta.title || ''), kind, req.file.filename, req.file.mimetype, Number(meta.seconds) || null, meta.consent_confirmed ? 1 : 0, created, now());
  if (Array.isArray(meta.people)) setEntryPeople(id, meta.people);
  enqueue(`rec:${id}`, () => processRecording(id));
  res.status(201).json(hydrateEntry(getEntryRow(id)));
});

entries.get('/:id', (req, res) => {
  const e = hydrateEntry(getEntryRow(req.params.id));
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json(e);
});

entries.patch('/:id', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  updateEntry(row.id, {
    title: typeof b.title === 'string' ? b.title : undefined,
    kind: KINDS.includes(b.kind) ? b.kind : undefined,
    body_md: typeof b.body_md === 'string' ? b.body_md : undefined,
    transcript: typeof b.transcript === 'string' ? b.transcript : undefined,
    tags: cleanTags(b.tags),
    created_at: b.created_at && !isNaN(Date.parse(b.created_at)) ? new Date(b.created_at).toISOString() : undefined,
    error: b.clear_error ? null : undefined
  });
  if (Array.isArray(b.people)) setEntryPeople(row.id, b.people, Array.isArray(b.mentioned) ? { mentioned: b.mentioned.map(String) } : {});
  if (typeof b.body_md === 'string') linkMentions(row.id, b.body_md);
  res.json(hydrateEntry(getEntryRow(row.id)));
});

entries.delete('/:id', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.audio_file) fs.rmSync(path.join(audioDir, row.audio_file), { force: true });
  for (const f of db.prepare('SELECT stored FROM entry_files WHERE entry_id = ? AND stored IS NOT NULL').all(row.id)) {
    fs.rmSync(path.join(filesDir, f.stored), { force: true });
  }
  db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

entries.get('/:id/audio', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row?.audio_file) return res.status(404).end();
  const mime = /^(audio|video)\/[\w.+-]+$/.test(row.audio_mime || '') ? row.audio_mime : 'application/octet-stream';
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.type(mime);
  res.sendFile(path.join(audioDir, path.basename(row.audio_file)), { acceptRanges: true, headers: { 'cache-control': 'private, max-age=3600' } });
});

entries.delete('/:id/audio', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.audio_file) fs.rmSync(path.join(audioDir, row.audio_file), { force: true });
  updateEntry(row.id, { audio_file: null });
  res.json(hydrateEntry(getEntryRow(row.id)));
});

entries.post('/:id/transcribe', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row?.audio_file) return res.status(400).json({ error: 'This entry has no audio.' });
  updateEntry(row.id, { status: 'transcribing', error: null });
  enqueue(`rec:${row.id}`, () => processRecording(row.id));
  res.status(202).json(hydrateEntry(getEntryRow(row.id)));
});

entries.post('/:id/analyze', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.body_md.trim() && !row.transcript.trim()) return res.status(400).json({ error: 'Write or record something first.' });
  if (row.status === 'transcribing' || row.status === 'processing') return res.status(409).json({ error: 'Still reading. Try again when it finishes.' });
  analyzeEntry(row.id).catch(err => console.error('[analyze]', err.message));
  res.status(202).json(hydrateEntry(getEntryRow(row.id)));
});
