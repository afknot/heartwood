import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, newId, now, listPeople } from '../db.js';
import { config, tmpDir } from '../config.js';
import { makeAvatar } from '../files.js';

export const people = express.Router();
const RELS = ['', 'direct_report', 'peer', 'manager', 'mentor', 'mentee', 'stakeholder', 'other']; // '' = not set
const avatarDir = path.join(config.dataDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });
const photoUpload = multer({ dest: tmpDir, limits: { fileSize: 25 * 1024 * 1024 } });

const cleanEmail = v => {
  const e = String(v || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
};

const cleanTz = v => {
  const tz = String(v || '').trim();
  if (!tz) return '';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return ''; }
};
const cleanCity = v => String(v || '').trim().slice(0, 80);

people.get('/', (req, res) => res.json(listPeople()));

// "she/her", "ze/hir", "any pronouns"… kept short and plain; empty means they/them.
const cleanPronouns = v => String(v || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'they/them';

people.post('/', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const id = newId();
  db.prepare('INSERT INTO people(id, name, role, relationship, notes, email, city, tz, pronouns, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, String(b.role || ''), RELS.includes(b.relationship) ? b.relationship : '', String(b.notes || ''), cleanEmail(b.email), cleanCity(b.city), cleanTz(b.tz), cleanPronouns(b.pronouns), now());
  res.status(201).json(listPeople().find(p => p.id === id));
});

people.get('/:id', (req, res) => {
  const p = listPeople().find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

people.patch('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (typeof b.email === 'string' && b.email.trim() && !cleanEmail(b.email)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
  db.prepare('UPDATE people SET name = ?, role = ?, relationship = ?, notes = ?, email = ?, city = ?, tz = ?, pronouns = ? WHERE id = ?').run(
    typeof b.name === 'string' && b.name.trim() ? b.name.trim() : p.name,
    typeof b.role === 'string' ? b.role : p.role,
    RELS.includes(b.relationship) ? b.relationship : p.relationship,
    typeof b.notes === 'string' ? b.notes : p.notes,
    typeof b.email === 'string' ? cleanEmail(b.email) : p.email,
    typeof b.city === 'string' ? cleanCity(b.city) : p.city,
    typeof b.tz === 'string' ? cleanTz(b.tz) : p.tz,
    typeof b.pronouns === 'string' ? cleanPronouns(b.pronouns) : p.pronouns,
    p.id
  );
  res.json(listPeople().find(x => x.id === p.id));
});

people.delete('/:id', (req, res) => {
  fs.rmSync(path.join(avatarDir, `${req.params.id}.jpg`), { force: true });
  db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- photos (stored on your server only) ----------
people.post('/:id/photo', photoUpload.single('photo'), async (req, res, next) => {
  const p = db.prepare('SELECT id FROM people WHERE id = ?').get(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Choose a photo.' });
  try {
    if (!p) return res.status(404).json({ error: 'Not found' });
    await makeAvatar(req.file.path, req.file.originalname, path.join(avatarDir, `${p.id}.jpg`));
    db.prepare('UPDATE people SET photo = ? WHERE id = ?').run(String(Date.now()), p.id);
    res.json(listPeople().find(x => x.id === p.id));
  } catch (err) {
    err.message = `Couldn’t use that photo: ${err.message}`;
    next(err);
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

people.get('/:id/photo', (req, res) => {
  const file = path.join(avatarDir, `${path.basename(req.params.id)}.jpg`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); // URL carries a version stamp
  res.type('image/jpeg').sendFile(file);
});

people.delete('/:id/photo', (req, res) => {
  fs.rmSync(path.join(avatarDir, `${path.basename(req.params.id)}.jpg`), { force: true });
  db.prepare('UPDATE people SET photo = NULL WHERE id = ?').run(req.params.id);
  res.json(listPeople().find(x => x.id === req.params.id));
});
