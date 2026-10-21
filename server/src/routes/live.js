// Live coach during a recording (see live.js).
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { tmpDir } from '../config.js';
import { newId } from '../db.js';
import { startLive, addAudio, suggestLive, endLive, LiveError } from '../live.js';
import { AIError } from '../llm.js';

export const live = express.Router();

const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir, filename: (req, file, cb) => cb(null, `live-${newId()}${(path.extname(file.originalname || '') || '.webm').toLowerCase().replace(/[^.\w]/g, '')}`) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

const fail = (res, err, next) => {
  if (err instanceof LiveError) return res.status(err.status || 400).json({ error: err.message });
  if (err instanceof AIError) return res.status(502).json({ error: err.message });
  // Transcription errors are about the engine setup; say so plainly.
  if (err?.message && err.name !== 'SqliteError') return res.status(502).json({ error: String(err.message).slice(0, 240) });
  return next(err);
};

live.post('/live', (req, res) => res.status(201).json(startLive(req.body || {})));
live.post('/live/:id/audio', upload.single('audio'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No audio received.' });
  try { res.json(await addAudio(req.params.id, req.file.path, req.body?.at)); }
  catch (err) { fs.rm(req.file.path, { force: true }, () => {}); fail(res, err, next); }
});
live.post('/live/:id/suggest', async (req, res, next) => {
  try { res.json(await suggestLive(req.params.id)); } catch (err) { fail(res, err, next); }
});
live.delete('/live/:id', (req, res) => res.json(endLive(req.params.id)));
