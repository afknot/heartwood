// Your inspiration: shows, films, books, people or eras you learn leadership from (Settings → About
// you). Each one adds quotes and "things to try" to Today. Heartwood's own built-in sets (Star Trek,
// Parks and Recreation, The Office, 30 Rock, '80s–2000s films) switch on when you add a match; for
// anything else the AI builds a set: practices in Heartwood's own words, and only short quotes it is
// confident are real. Those quotes are marked as AI-picked so you know to check them.
import { db, newId, now, getSettings } from './db.js';
import { complete } from './llm.js';
import { profileBlock } from './prompts.js';

const STYLE_IDS = ['servant', 'space', 'mediator', 'coach', 'empathetic', 'candid', 'visionary'];
const MAX = 24;

// ---------- built-in sets ----------
/** Which built-in set a quote's work or a practice's source belongs to (null = always on). */
export function packOf(text = '') {
  const t = String(text);
  if (/^Star Trek/.test(t)) return 'star-trek';
  if (/^Parks and Recreation/.test(t)) return 'parks';
  if (/^The Office/.test(t)) return 'office';
  if (/^30 Rock/.test(t)) return 'rock';
  if (/\((19[89]\d|200\d)\)/.test(t)) return 'movies';
  return null;
}

/** The built-in set a name you typed turns on, if any. */
export function matchPack(name = '') {
  const n = String(name).toLowerCase();
  if (/trek|picard|kirk\b|spock|starfleet/.test(n)) return 'star-trek';
  if (/parks\s*(and|&|n)?\s*rec|knope|swanson/.test(n)) return 'parks';
  if (/\bthe office\b|michael scott|dunder/.test(n)) return 'office';
  if (/30\s*rock|thirty rock|lemon|donaghy/.test(n)) return 'rock';
  if (/movie|film|cinema/.test(n)) return 'movies';
  return null;
}

export const listInspirations = () => db.prepare(`SELECT i.*,
    (SELECT COUNT(*) FROM inspiration_items x WHERE x.inspiration_id = i.id AND x.kind = 'quote') AS quotes,
    (SELECT COUNT(*) FROM inspiration_items x WHERE x.inspiration_id = i.id AND x.kind = 'practice') AS practices
  FROM inspirations i ORDER BY i.created_at`).all().map(r => ({ ...r, pack: matchPack(r.name) }));

/** Built-in sets turned on by what you've added. */
export const activePacks = () => new Set(db.prepare('SELECT name FROM inspirations').all().map(r => matchPack(r.name)).filter(Boolean));

/** Your AI-built quotes or practices, shaped like the built-in ones. */
export function customItems(kind) {
  return db.prepare(`SELECT x.id, x.data, i.name FROM inspiration_items x JOIN inspirations i ON i.id = x.inspiration_id WHERE x.kind = ?`).all(kind)
    .map(r => { try { return { ...JSON.parse(r.data), id: `insp:${r.id}`, inspiration: r.name, ai: true }; } catch { return null; } })
    .filter(Boolean);
}

// ---------- adding, removing ----------
export class InspirationError extends Error {}

export function addInspiration(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new InspirationError('Name a show, film, book, person or era.');
  if (db.prepare('SELECT COUNT(*) AS c FROM inspirations').get().c >= MAX) throw new InspirationError(`That’s ${MAX}. Remove one to add another.`);
  if (db.prepare('SELECT 1 FROM inspirations WHERE lower(name) = lower(?)').get(n)) throw new InspirationError('That one’s already on your list.');
  const id = newId(), t = now();
  db.prepare(`INSERT INTO inspirations(id, name, status, created_at, updated_at) VALUES (?, ?, 'building', ?, ?)`).run(id, n, t, t);
  return id;
}

export function removeInspiration(id) {
  db.prepare('DELETE FROM inspiration_items WHERE inspiration_id = ?').run(id);
  return db.prepare('DELETE FROM inspirations WHERE id = ?').run(id).changes;
}

/** What was built from one source, to look over. */
export const itemsFor = id => db.prepare('SELECT id, kind, data FROM inspiration_items WHERE inspiration_id = ? ORDER BY kind, created_at').all(id)
  .map(r => { try { return { id: r.id, kind: r.kind, ...JSON.parse(r.data) }; } catch { return null; } }).filter(Boolean);
export const removeItem = itemId => db.prepare('DELETE FROM inspiration_items WHERE id = ?').run(itemId).changes;

export const markBuilding = id => db.prepare(`UPDATE inspirations SET status = 'building', error = NULL, updated_at = ? WHERE id = ?`).run(now(), id);

// ---------- building a set with the AI ----------
const SYSTEM = profile => `You help a people leader learn leadership from a source they love: a TV show, film, book, historical era, group of people, or a specific person.

${profileBlock(profile)}

Build a small set for their private leadership journal:
1. "practices": 6 to 10 small, concrete things to try at work today, each inspired by a specific moment, character or habit from the source. Write them in your own words: never reproduce scripts, books or speeches. Each has:
   - "title": under 9 words, an action ("Send the away team").
   - "how": 1 to 3 sentences. Say what to do today and why it helps. Name the moment or person it comes from in passing.
   - "from": where it comes from, short (an episode, chapter, film, speech or event), or "" if general.
   - "fit": "talk" if it needs a conversation today, "busy" if it suits a packed day, otherwise "any".
   - "styles": 1 or 2 of ${STYLE_IDS.join(', ')}.
2. "quotes": up to 8 short, real lines about leading, teamwork, courage, learning or how to treat people.
   - Only lines you are highly confident are word-for-word and correctly attributed. If you aren't sure, leave it out: fewer is fine, none is fine. Never invent or "improve" a quote.
   - 20 words or fewer. No song lyrics or poetry.
   - "text", "who" (who says it), "work" (the show and episode, film and year, book, or speech and year), "styles" (1 or 2 of the list above).
   - A line from a comic character can be an example of what not to do; say so in "work", e.g. "The Office (a cautionary tale)".
3. "label": the source's usual name, properly spelled.

If the source is a private individual, or isn't a fit for learning about leadership, return empty lists and explain kindly in "note".

Return JSON only: {"label":"...","practices":[...],"quotes":[...],"note":""}`;

const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = s => clean(s, 400).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');

/** Ask the AI for a set and store it, replacing any earlier AI set for this source. */
export async function buildInspiration(id, { builtinQuotes = [], builtinPractices = [] } = {}) {
  const row = db.prepare('SELECT * FROM inspirations WHERE id = ?').get(id);
  if (!row) return;
  try {
    const pack = matchPack(row.name);
    const known = pack ? [
      ...builtinQuotes.filter(q => packOf(q.work) === pack).map(q => `- Quote already included: "${q.text}" (${q.who})`),
      ...builtinPractices.filter(p => packOf(p.source) === pack).map(p => `- Practice already included: ${p.title}`)
    ] : [];
    const user = `Source: ${row.name}${known.length ? `\n\nHeartwood already has these from it; add different ones:\n${known.join('\n')}` : ''}`;
    const out = await complete({ system: SYSTEM(getSettings().profile), messages: [{ role: 'user', content: user }], json: true, maxTokens: 3500, task: 'inspiration' });
    const styles = v => (Array.isArray(v) ? v : []).filter(s => STYLE_IDS.includes(s)).slice(0, 2);
    const label = clean(out?.label, 80) || row.name;
    const seen = new Set(builtinQuotes.map(q => norm(q.text)));
    const quotes = (Array.isArray(out?.quotes) ? out.quotes : [])
      .map(q => ({ text: clean(q.text, 220), who: clean(q.who, 80), work: clean(q.work, 140) || label, styles: styles(q.styles), url: '' }))
      .filter(q => q.text && q.who && q.text.split(/\s+/).length <= 22 && !seen.has(norm(q.text)) && seen.add(norm(q.text)))
      .slice(0, 8);
    const practices = (Array.isArray(out?.practices) ? out.practices : [])
      .map(p => ({ title: clean(p.title, 90), how: clean(p.how, 420), fit: ['talk', 'busy', 'any'].includes(p.fit) ? p.fit : 'any', styles: styles(p.styles),
        source: clean(p.from, 120) ? `${label}, ${clean(p.from, 120)}` : label }))
      .filter(p => p.title && p.how).slice(0, 10);
    const note = clean(out?.note, 300);
    const ins = db.prepare('INSERT INTO inspiration_items(id, inspiration_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM inspiration_items WHERE inspiration_id = ?').run(id);
      for (const q of quotes) ins.run(newId(), id, 'quote', JSON.stringify(q), now());
      for (const p of practices) ins.run(newId(), id, 'practice', JSON.stringify(p), now());
      db.prepare(`UPDATE inspirations SET status = 'ready', note = ?, error = NULL, updated_at = ? WHERE id = ?`)
        .run(!quotes.length && !practices.length ? (note || 'Nothing to build from this one.') : note || null, now(), id);
    })();
  } catch (err) {
    db.prepare(`UPDATE inspirations SET status = 'error', error = ?, updated_at = ? WHERE id = ?`).run(clean(err.message, 240), now(), id);
  }
}
