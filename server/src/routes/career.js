import express from 'express';
import { db } from '../db.js';
import {
  combineEvidence, CareerError, listEvidence, extractEvidence, updateEvidence, addEvidence, githubStatus,
  createDraft, updateDraft, exportDraft, draftOut
} from '../career.js';
import { CAREER_THEMES } from '../prompts.js';
import { markGiven, pendingWins, recentKudos, KudosError } from '../kudos.js';

export const career = express.Router();

const handle = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof CareerError || err instanceof KudosError) return res.status(err.message === 'Not found' ? 404 : 400).json({ error: err.message });
    next(err);
  }
};

career.get('/career', (req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM evidence GROUP BY status').all().map(r => [r.status, r.n]));
  res.json({ github: githubStatus(), counts, themes: CAREER_THEMES });
});

// ---------- evidence ----------
career.get('/career/evidence', (req, res) => {
  const status = ['suggested', 'confirmed', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  res.json(listEvidence(status));
});

career.post('/career/evidence/extract', handle(async (req, res) => {
  const valid = s => typeof s === 'string' && !isNaN(Date.parse(s));
  const { from_iso: fromIso, to_iso: toIso } = req.body || {};
  if (!valid(fromIso) || !valid(toIso)) return res.status(400).json({ error: 'Pick a date range.' });
  res.status(201).json(await extractEvidence({ fromIso: new Date(fromIso).toISOString(), toIso: new Date(toIso).toISOString() }));
}));

career.post('/career/evidence/combine', handle(async (req, res) => res.json(await combineEvidence())));
career.post('/career/evidence', handle(async (req, res) => res.status(201).json(addEvidence(req.body))));
career.patch('/career/evidence/:id', handle(async (req, res) => res.json(updateEvidence(req.params.id, req.body))));
career.delete('/career/evidence/:id', (req, res) => {
  db.prepare('DELETE FROM evidence WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- drafts ----------
career.get('/career/drafts', (req, res) => {
  const rows = db.prepare('SELECT id, kind, title, status, pr_url, created_at, updated_at FROM career_drafts ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});
career.get('/career/drafts/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(draftOut(r));
});
career.post('/career/drafts', handle(async (req, res) => {
  const { kind, angle, evidence_ids: evidenceIds, current, person_id: personId, win } = req.body || {};
  if (!['story', 'resume', 'linkedin', 'recognition'].includes(kind)) return res.status(400).json({ error: 'Pick a draft type.' });
  res.status(201).json(await createDraft({
    kind, angle: String(angle || ''), evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.slice(0, 120) : [],
    current: String(current || ''), personId: String(personId || ''), win: String(win || '')
  }));
}));
career.patch('/career/drafts/:id', handle(async (req, res) => res.json(updateDraft(req.params.id, req.body))));
// Kudos: note where you gave it.
career.post('/career/drafts/:id/given', handle(async (req, res) => res.json(markGiven({ draftId: req.params.id, to: String(req.body?.to || '') }))));
// What's worth recognizing for someone, and your latest kudos for them (for prep and agendas).
career.get('/people/:id/kudos', (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const k = recentKudos(p);
  res.json({ wins: pendingWins(p), recent: k && { id: k.id, created_at: k.created_at, say: k.say || '', win: k.win || '', sent: k.sent || [] } });
});
career.post('/career/drafts/:id/export', handle(async (req, res) => res.json(await exportDraft(req.params.id))));
career.delete('/career/drafts/:id', (req, res) => {
  db.prepare('DELETE FROM career_drafts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
