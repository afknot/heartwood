// Talking to and about people: drafting messages in your voice, your voice profile, and context threads.
import express from 'express';
import { compose, usedDraft } from '../compose.js';
import { addSample, deleteSample, voiceStatus, refreshProfile, setOwnWords } from '../voice.js';
import { addContext, listContext, deleteContext, updateNotesPlan, moveUpdateNotes, KINDS } from '../context.js';

export const talk = express.Router();
const fail = (res, err, next) => (err.status ? res.status(err.status).json({ error: err.message }) : next(err));

// ---------- write a message ----------
talk.post('/compose', async (req, res, next) => {
  try { res.json(await compose(req.body || {})); } catch (err) { fail(res, err, next); }
});
// You used a draft (copied it or opened it in Mail): learn from your edits; optionally note it was sent.
talk.post('/compose/used', (req, res) => {
  const b = req.body || {};
  const r = usedDraft({ text: b.text, original: b.original, channel: b.channel, audience: b.audience });
  if (b.log && r.ok) {
    const line = `Sent${b.channel === 'email' ? ' an email' : b.channel === 'slack' ? ' a message' : b.channel === 'text' ? ' a text' : ''}${b.subject_line ? `: “${String(b.subject_line).slice(0, 120)}”` : ''}. ${String(b.text).replace(/\s+/g, ' ').slice(0, 220)}${String(b.text).length > 220 ? '…' : ''}`;
    for (const s of (Array.isArray(b.subjects) ? b.subjects : []).slice(0, 6)) {
      if (KINDS.includes(s?.kind) && typeof s.id === 'string') { try { addContext({ kind: s.kind, id: s.id, text: line, source: 'sent' }); } catch { /* skip */ } }
    }
  }
  res.json(r);
});

// ---------- your voice ----------
talk.get('/voice', (req, res) => res.json(voiceStatus()));
talk.put('/voice/own-words', (req, res) => res.json(setOwnWords(req.body?.text)));
talk.post('/voice/learn', async (req, res, next) => {
  try { await refreshProfile(); res.json(voiceStatus()); } catch (err) { fail(res, err, next); }
});
// An exercise answer, or a message you've sent: { text, kind: 'exercise'|'example', situation, channel, audience }
talk.post('/voice/samples', (req, res) => {
  try {
    const b = req.body || {};
    addSample({ text: b.text, kind: b.kind === 'exercise' ? 'exercise' : 'example', situation: b.situation || '', channel: b.channel || '', audience: b.audience || '' });
    res.status(201).json(voiceStatus());
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
talk.delete('/voice/samples/:id', (req, res) => { deleteSample(req.params.id); res.json(voiceStatus()); });

// ---------- context threads ----------
talk.get('/context/:kind/:id', (req, res) => res.json(listContext(req.params.kind, req.params.id)));
talk.post('/context/:kind/:id', (req, res) => {
  try { res.status(201).json(addContext({ kind: req.params.kind, id: req.params.id, text: req.body?.text, source: 'you' })); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
talk.delete('/context-notes/:id', (req, res) => { deleteContext(req.params.id); res.json({ ok: true }); });
// Old update notes in the journal → context on the people they're about.
talk.get('/context/move-updates', (req, res) => res.json({ count: updateNotesPlan().length }));
talk.post('/context/move-updates', (req, res) => res.json(moveUpdateNotes()));
