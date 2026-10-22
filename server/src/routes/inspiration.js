// Your inspiration (Settings → About you): add a show, film, book, person or era, and Heartwood
// builds quotes and things to try from it in the background.
import express from 'express';
import { enqueue } from '../jobs.js';
import { QUOTES } from '../leadership.js';
import { PRACTICES } from '../practices.js';
import { listInspirations, addInspiration, removeInspiration, markBuilding, buildInspiration, itemsFor, removeItem, InspirationError } from '../inspiration.js';
import { db } from '../db.js';

export const inspiration = express.Router();

const build = id => enqueue(`insp:${id}`, () => buildInspiration(id, { builtinQuotes: QUOTES, builtinPractices: PRACTICES }));

/** Pick up any that were mid-build when the server stopped. */
export function resumeInspirations() {
  for (const { id } of db.prepare(`SELECT id FROM inspirations WHERE status = 'building'`).all()) build(id);
}

inspiration.get('/inspirations', (req, res) => res.json(listInspirations()));
inspiration.post('/inspirations', (req, res) => {
  try { const id = addInspiration(req.body?.name); build(id); res.status(201).json(listInspirations()); }
  catch (err) { if (err instanceof InspirationError) return res.status(400).json({ error: err.message }); throw err; }
});
inspiration.post('/inspirations/:id/rebuild', (req, res) => {
  markBuilding(req.params.id); build(req.params.id); res.json(listInspirations());
});
inspiration.get('/inspirations/:id/items', (req, res) => res.json(itemsFor(req.params.id)));
inspiration.delete('/inspirations/items/:itemId', (req, res) => { removeItem(req.params.itemId); res.json(listInspirations()); });
inspiration.delete('/inspirations/:id', (req, res) => { removeInspiration(req.params.id); res.json(listInspirations()); });
