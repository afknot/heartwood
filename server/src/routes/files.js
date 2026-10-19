import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { filesDir } from '../config.js';
import { db, newId, now, hydrateEntry, getEntryRow, setEntryPeople } from '../db.js';
import { ACCEPTED_EXT, fileKind } from '../files.js';
import { splitByDates, hashText } from '../documents.js';
import { enqueue, processFiles } from '../jobs.js';

export const files = express.Router();

const MAX_FILES = 20;
const upload = multer({
  storage: multer.diskStorage({
    destination: filesDir,
    filename: (req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname || '').toLowerCase()}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED_EXT.includes(path.extname(file.originalname || '').toLowerCase()))
});

const KINDS = ['note', 'memo', 'conversation', 'one_on_one', 'meeting'];

/** file_notes is an array in the same order as the uploaded files. */
function insertFiles(entryId, list, notes = []) {
  const ins = db.prepare(`INSERT INTO entry_files(id, entry_id, name, mime, size, kind, stored, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  list.forEach((f, i) => ins.run(newId(), entryId, f.originalname, f.mimetype || '', f.size, fileKind(f.originalname), f.filename,
    String((Array.isArray(notes) && notes[i]) || '').trim().slice(0, 1000), new Date(Date.now() + i).toISOString()));
}

// Create a note from one or more files. Responds right away; reading happens in the background.
files.post('/entries/files', upload.array('files', MAX_FILES), (req, res) => {
  const list = req.files || [];
  if (!list.length) return res.status(400).json({ error: `Add at least one file (${ACCEPTED_EXT.join(', ')}).` });
  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch {}
  const id = newId();
  const t = now();
  const context = String(meta.context || '').trim().slice(0, 5000);
  db.transaction(() => {
    db.prepare(`INSERT INTO entries(id, title, kind, body_md, user_context, tags, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', 'processing', 'files', ?, ?)`)
      .run(id, String(meta.title || '').slice(0, 120), KINDS.includes(meta.kind) ? meta.kind : 'note', context, context, t, t);
    insertFiles(id, list, meta.file_notes);
    if (Array.isArray(meta.people)) setEntryPeople(id, meta.people);
  })();
  enqueue(`files:${id}`, () => processFiles(id, { context }));
  res.status(201).json(hydrateEntry(getEntryRow(id)));
});

const SEP = /\n\n---\n\n/;
function busy(row) { return ['processing', 'transcribing', 'analyzing'].includes(row.status); }
function rebuildSourceText(entryId) {
  const rows = db.prepare(`SELECT name, extracted_text FROM entry_files WHERE entry_id = ? AND status = 'ready' ORDER BY created_at, name`).all(entryId);
  db.prepare('UPDATE entries SET source_text = ? WHERE id = ?').run(rows.map(r => `#### ${r.name}\n${r.extracted_text}`).join('\n\n'), entryId);
}
/** Capture any edits you made above the "---" before the note is rewritten. */
function refreshContext(row) {
  if (SEP.test(row.body_md)) db.prepare('UPDATE entries SET user_context = ? WHERE id = ?').run(row.body_md.split(SEP)[0].trim(), row.id);
}

// Add more files to an existing note; they're read, then the note is rewritten from all files.
files.post('/entries/:id/files', upload.array('files', MAX_FILES), (req, res) => {
  const row = getEntryRow(req.params.id);
  const list = req.files || [];
  if (!row) { list.forEach(f => fs.rmSync(f.path, { force: true })); return res.status(404).json({ error: 'Not found' }); }
  if (busy(row)) { list.forEach(f => fs.rmSync(f.path, { force: true })); return res.status(409).json({ error: 'Still working on this note. Try again in a moment.' }); }
  if (!list.length) return res.status(400).json({ error: `Add at least one file (${ACCEPTED_EXT.join(', ')}).` });
  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch {}
  if (meta.quiet) {
    // Pasted or dropped into the note: read the files, but leave the note as you wrote it.
    insertFiles(row.id, list, meta.file_notes);
    db.prepare(`UPDATE entries SET status = 'processing' WHERE id = ?`).run(row.id);
    enqueue(`files:${row.id}`, () => processFiles(row.id, { quiet: true }));
    return res.status(202).json(hydrateEntry(getEntryRow(row.id)));
  }
  if (row.source !== 'files') {
    // A plain note or recording becoming a files note: everything you wrote so far is your context.
    db.prepare(`UPDATE entries SET source = 'files', user_context = ? WHERE id = ?`).run(row.body_md.trim(), row.id);
  } else refreshContext(row);
  insertFiles(row.id, list, meta.file_notes);
  db.prepare(`UPDATE entries SET status = 'processing' WHERE id = ?`).run(row.id);
  enqueue(`files:${row.id}`, () => processFiles(row.id));
  res.status(202).json(hydrateEntry(getEntryRow(row.id)));
});

// Edit your note on one file. Takes effect the next time the note is written.
files.patch('/files/:id', (req, res) => {
  const f = db.prepare('SELECT entry_id FROM entry_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE entry_files SET note = ? WHERE id = ?').run(String(req.body?.note || '').trim().slice(0, 1000), req.params.id);
  res.json(hydrateEntry(getEntryRow(f.entry_id)));
});

// Remove one file from a note (the file and what was read from it).
files.delete('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM entry_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const row = getEntryRow(f.entry_id);
  if (busy(row)) return res.status(409).json({ error: 'Still working on this note. Try again in a moment.' });
  if (f.stored) fs.rmSync(path.join(filesDir, f.stored), { force: true });
  db.prepare('DELETE FROM entry_files WHERE id = ?').run(f.id);
  rebuildSourceText(f.entry_id);
  res.json(hydrateEntry(getEntryRow(f.entry_id)));
});

// Rewrite the note (and reflection) from the files that are left.
files.post('/entries/:id/rewrite', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (busy(row)) return res.status(409).json({ error: 'Already working on this note.' });
  if (!db.prepare(`SELECT 1 FROM entry_files WHERE entry_id = ? AND status = 'ready'`).get(row.id)) return res.status(400).json({ error: 'There are no files left to write from.' });
  refreshContext(row);
  db.prepare(`UPDATE entries SET status = 'processing', error = NULL WHERE id = ?`).run(row.id);
  enqueue(`files:${row.id}`, () => processFiles(row.id));
  res.status(202).json(hydrateEntry(getEntryRow(row.id)));
});

// View or download an attached file.
files.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM entry_files WHERE id = ?').get(req.params.id);
  if (!f?.stored) return res.status(404).end();
  // Show raster images and PDFs in the browser; download everything else. Uploaded files are untrusted:
  // never render SVG/HTML inline, and sandbox whatever is shown.
  const mime = String(f.mime || '').toLowerCase();
  const inline = (f.kind === 'image' && /^image\/(jpeg|png|gif|webp|heic|heif|avif)$/.test(mime)) || mime === 'application/pdf';
  // (PDFs are left unsandboxed: browsers refuse to show a PDF in a sandboxed document.)
  if (mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.type(inline ? mime : 'application/octet-stream');
  res.sendFile(path.join(filesDir, path.basename(f.stored)));
});

// Delete the stored files but keep what was read from them.
files.delete('/entries/:id/files', (req, res) => {
  const rows = db.prepare('SELECT id, stored FROM entry_files WHERE entry_id = ? AND stored IS NOT NULL').all(req.params.id);
  for (const r of rows) fs.rmSync(path.join(filesDir, r.stored), { force: true });
  db.prepare('UPDATE entry_files SET stored = NULL WHERE entry_id = ?').run(req.params.id);
  res.json(hydrateEntry(getEntryRow(req.params.id)));
});

// Retry reading files that failed.
files.post('/entries/:id/files/retry', (req, res) => {
  const row = getEntryRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE entry_files SET status = 'pending', error = NULL WHERE entry_id = ? AND status = 'error' AND stored IS NOT NULL`).run(row.id);
  enqueue(`files:${row.id}`, () => processFiles(row.id));
  res.status(202).json(hydrateEntry(getEntryRow(row.id)));
});

// Split a running log (e.g. years of 1:1 notes) into one entry per dated section: returns an import preview to review.
files.post('/files/:id/split', (req, res) => {
  const f = db.prepare('SELECT * FROM entry_files WHERE id = ?').get(req.params.id);
  if (!f?.extracted_text) return res.status(404).json({ error: 'Nothing to split.' });
  const entry = hydrateEntry(getEntryRow(f.entry_id));
  const seen = db.prepare(`SELECT 1 FROM entries WHERE source_hash LIKE '%' || ? || '%' LIMIT 1`);
  const segments = splitByDates(f.extracted_text).map(s => {
    const h = hashText(s.text);
    return { ...s, text: s.text.slice(0, 40000), hash: h, duplicate: !!seen.get(h) };
  });
  const id = newId();
  db.prepare(`INSERT INTO imports(id, person_id, file_name, file_hash, segments, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, entry.people[0]?.id || null, f.name, `file:${f.id}`, JSON.stringify(segments), now());
  res.status(201).json({ id });
});
