// Open loops: every commitment or follow-up found in your notes, in one list you can tick off.
import { db, newId, now, getSettings, safeJson } from './db.js';
import { prioritize, keySet } from './priority.js';

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** Is this follow-up yours (vs. something you're waiting on someone else for)? */
export function isMine(owner, profileName = getSettings().profile?.name || '') {
  const o = norm(owner);
  if (!o || ['me', 'i', 'myself', 'you', 'writer', 'the writer', 'manager'].includes(o)) return true;
  const me = norm(profileName);
  return !!me && (o === me || o === me.split(' ')[0]);
}

/** Find the person a follow-up is about: its owner if they're in People, else the entry's only linked person. */
function personFor(owner, entryId) {
  const o = norm(owner);
  if (o) {
    const people = db.prepare('SELECT id, name FROM people').all();
    const hit = people.find(p => norm(p.name) === o) || (() => {
      const byFirst = people.filter(p => norm(p.name).split(' ')[0] === o.split(' ')[0]);
      return byFirst.length === 1 ? byFirst[0] : null;
    })();
    if (hit) return hit.id;
  }
  if (!entryId) return null;
  const linked = db.prepare('SELECT person_id FROM entry_people WHERE entry_id = ?').all(entryId);
  return linked.length === 1 ? linked[0].person_id : null;
}

/**
 * Replace the AI-found follow-ups for an entry with a fresh list, keeping anything
 * you've already ticked off or dismissed (so re-reflecting never resurrects done items).
 */
export function syncFollowups(entryId, items = []) {
  const existing = db.prepare(`SELECT * FROM followups WHERE entry_id = ? AND source = 'ai'`).all(entryId);
  const settled = new Set(existing.filter(f => f.done_at || f.dismissed || f.archived_at).map(f => norm(f.text)));
  db.transaction(() => {
    db.prepare(`DELETE FROM followups WHERE entry_id = ? AND source = 'ai' AND done_at IS NULL AND dismissed = 0 AND archived_at IS NULL`).run(entryId);
    const ins = db.prepare(`INSERT INTO followups(id, entry_id, person_id, text, owner, due, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ai', ?)`);
    const seen = new Set();
    for (const it of items || []) {
      const text = String(it?.text || '').trim();
      const key = norm(text);
      if (!text || settled.has(key) || seen.has(key)) continue;
      seen.add(key);
      ins.run(newId(), entryId, personFor(it.owner, entryId), text.slice(0, 500), String(it.owner || '').slice(0, 100), String(it.due || '').slice(0, 100), now());
    }
  })();
}

/** First run after upgrading: build the list from every reflection you already have. */
export function backfillFollowups() {
  const done = db.prepare(`SELECT value FROM settings WHERE key = '_followups_backfilled'`).get();
  if (done) return;
  const rows = db.prepare(`SELECT id, analysis FROM entries WHERE analysis IS NOT NULL`).all();
  for (const r of rows) {
    const a = safeJson(r.analysis, null);
    if (a?.action_items?.length) syncFollowups(r.id, a.action_items);
  }
  db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('_followups_backfilled', 'true')`).run();
}

export function listFollowups({ status = 'open', personId = null, limit = 200 } = {}) {
  const where = status === 'done' ? ['f.done_at IS NOT NULL', 'f.dismissed = 0']
    : status === 'archived' ? ['f.archived_at IS NOT NULL', 'f.done_at IS NULL', 'f.dismissed = 0']
    : ['f.done_at IS NULL', 'f.dismissed = 0', 'f.archived_at IS NULL'];
  const args = [];
  if (personId) { where.push('f.person_id = ?'); args.push(personId); }
  const rows = db.prepare(`
    SELECT f.*, e.title AS entry_title, e.created_at AS entry_date, p.name AS person_name
    FROM followups f
    LEFT JOIN entries e ON e.id = f.entry_id
    LEFT JOIN people p ON p.id = f.person_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${status === 'done' ? 'f.done_at DESC' : status === 'archived' ? 'f.archived_at DESC, COALESCE(e.created_at, f.created_at) DESC' : 'COALESCE(e.created_at, f.created_at) DESC'}
    LIMIT ?`).all(...args, status === 'open' ? 5000 : limit);
  const name = getSettings().profile?.name || '';
  const list = rows.map(r => ({ ...r, mine: isMine(r.owner, name) }));
  return status === 'open' ? prioritize(list, priorityContext(personId)).slice(0, limit) : list;
}

/** What ranking needs from the database: who your managers are, who was in each note, and recent asks. */
function priorityContext(personId) {
  const managers = new Map(db.prepare(`SELECT id, name FROM people WHERE relationship = 'manager'`).all().map(p => [p.id, p.name]));
  const entryPeople = new Map();
  if (managers.size) {
    for (const r of db.prepare(`SELECT entry_id, person_id FROM entry_people WHERE person_id IN (${[...managers.keys()].map(() => '?').join(',')})`).all(...managers.keys())) {
      if (!entryPeople.has(r.entry_id)) entryPeople.set(r.entry_id, []);
      entryPeople.get(r.entry_id).push(r.person_id);
    }
  }
  const since = new Date(Date.now() - 180 * DAY).toISOString();
  const history = db.prepare(`SELECT f.id, f.entry_id, f.person_id, f.text FROM followups f LEFT JOIN entries e ON e.id = f.entry_id
    WHERE COALESCE(e.created_at, f.created_at) >= ? ${personId ? 'AND f.person_id = ?' : ''} LIMIT 6000`).all(...(personId ? [since, personId] : [since]));
  return { managers, entryPeople, history };
}

// ---------- tidying up ----------
// Old follow-ups (mostly from imported history) bury the real ones. Tidying archives open items from
// notes older than a cutoff, except ones that came up again in a recent note. Archived items are
// kept and can be restored; nothing is deleted.

const STOP = new Set(('about after again also because before being between could doing during every first their there these '
  + 'thing things think those through under until where which while would should other really still maybe going follow check '
  + 'share update meeting meetings email schedule people person someone work team next week weeks month')
  .split(' '));
const keywords = text => [...new Set(norm(text).split(' ').filter(w => w.length >= 5 && !STOP.has(w)))];
const DAY = 864e5;

/** Open follow-ups from notes before the cutoff, split into what to archive and what to keep. */
export function tidyPlan({ days = 90, recentDays = 45 } = {}) {
  const cutoff = new Date(Date.now() - days * DAY).toISOString();
  const recentFrom = new Date(Date.now() - recentDays * DAY).toISOString();
  const old = db.prepare(`
    SELECT f.id, f.text, f.person_id, f.owner, COALESCE(e.created_at, f.created_at) AS dated, e.title AS entry_title, p.name AS person_name
    FROM followups f LEFT JOIN entries e ON e.id = f.entry_id LEFT JOIN people p ON p.id = f.person_id
    WHERE f.done_at IS NULL AND f.dismissed = 0 AND f.archived_at IS NULL AND COALESCE(e.created_at, f.created_at) < ?
    ORDER BY dated`).all(cutoff);
  const recent = db.prepare(`SELECT id, title, body_md, transcript FROM entries WHERE created_at >= ?`).all(recentFrom)
    .map(e => ({ id: e.id, text: ` ${norm(`${e.title} ${e.body_md} ${e.transcript}`)} ` }));
  const recentByPerson = new Map();
  for (const r of db.prepare(`SELECT ep.person_id, ep.entry_id FROM entry_people ep JOIN entries e ON e.id = ep.entry_id WHERE e.created_at >= ?`).all(recentFrom)) {
    if (!recentByPerson.has(r.person_id)) recentByPerson.set(r.person_id, new Set());
    recentByPerson.get(r.person_id).add(r.entry_id);
  }
  const archive = [], keep = [];
  for (const f of old) {
    const words = keywords(f.text);
    const pool = f.person_id && recentByPerson.has(f.person_id) ? recent.filter(e => recentByPerson.get(f.person_id).has(e.id)) : recent;
    const need = Math.min(2, words.length);
    const hit = need > 0 && pool.some(e => words.filter(w => e.text.includes(` ${w}`)).length >= need);
    (hit ? keep : archive).push(f);
  }
  return { days, cutoff, archive, keep };
}

export function tidyApply({ days = 90 } = {}) {
  const plan = tidyPlan({ days });
  const batch = now();
  const upd = db.prepare('UPDATE followups SET archived_at = ? WHERE id = ? AND archived_at IS NULL');
  db.transaction(() => { for (const f of plan.archive) upd.run(batch, f.id); })();
  return { archived: plan.archive.length, kept: plan.keep.length, batch };
}

/** Restore one cleanup (by its batch time) or specific items. */
export function restoreFollowups({ batch, ids } = {}) {
  if (batch) return db.prepare('UPDATE followups SET archived_at = NULL WHERE archived_at = ?').run(batch).changes;
  const upd = db.prepare('UPDATE followups SET archived_at = NULL WHERE id = ?');
  let n = 0;
  db.transaction(() => { for (const id of ids || []) n += upd.run(id).changes; })();
  return n;
}

/** Mark many as done, archive or dismiss them in one go. */
export function bulkFollowups(ids = [], action) {
  const sql = { done: 'UPDATE followups SET done_at = ? WHERE id = ? AND done_at IS NULL',
    archive: 'UPDATE followups SET archived_at = ? WHERE id = ? AND archived_at IS NULL',
    restore: 'UPDATE followups SET archived_at = NULL WHERE id = ? AND ? IS NOT NULL',
    dismiss: 'UPDATE followups SET dismissed = 1 WHERE id = ? AND ? IS NOT NULL' }[action];
  if (!sql) throw new Error('Unknown action');
  const stmt = db.prepare(sql);
  const t = now();
  let n = 0;
  db.transaction(() => {
    for (const id of ids.slice(0, 2000)) n += (action === 'done' || action === 'archive' ? stmt.run(t, id) : stmt.run(id, t)).changes;
  })();
  return { changed: n, at: t };
}

/** Let follow-ups go on purpose: they leave the list and count as handled, not failed. */
export const LET_GO = { decided: 'Decided not to', not_needed: 'No longer needed' };
export function letGo(ids = [], reason) {
  if (!LET_GO[reason]) throw new Error('Pick why you’re letting it go.');
  const stmt = db.prepare('UPDATE followups SET dismissed = 1, let_go = ?, let_go_at = ? WHERE id = ? AND done_at IS NULL');
  const t = now();
  let n = 0;
  db.transaction(() => { for (const id of ids.slice(0, 500)) n += stmt.run(reason, t, String(id)).changes; })();
  return { changed: n, at: t };
}

export function oldOpenCount(days = 90) {
  const cutoff = new Date(Date.now() - days * DAY).toISOString();
  return db.prepare(`SELECT COUNT(*) AS n FROM followups f LEFT JOIN entries e ON e.id = f.entry_id
    WHERE f.done_at IS NULL AND f.dismissed = 0 AND f.archived_at IS NULL AND COALESCE(e.created_at, f.created_at) < ?`).get(cutoff).n;
}

// ---------- where a follow-up came from ----------
// Follow-ups are distilled by the AI, so they rarely match the note word for word. Find the passage
// (a line of the note, a sentence of the transcript, original or attached file) that shares the most
// key words with it, so the note can open with that passage highlighted.

/** Markdown line → the text as it reads on screen. */
const plainLine = l => l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__|\*|_|~~|`)/g, '').trim();

const sentences = text => String(text || '').split(/\n+/).flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/))
  .map(s => s.trim()).filter(s => s.length >= 8);

export function findSource(followupId) {
  const f = db.prepare('SELECT id, entry_id, text FROM followups WHERE id = ?').get(followupId);
  if (!f) return null;
  const empty = { entry_id: f.entry_id, where: null, quote: '', text: f.text };
  if (!f.entry_id) return empty;
  const e = db.prepare('SELECT body_md, transcript, source_text, analysis FROM entries WHERE id = ?').get(f.entry_id);
  if (!e) return empty;
  const want = keySet(f.text);
  if (!want.size) return empty;

  const pools = [{ where: 'note', bonus: 0.6, parts: String(e.body_md || '').split('\n').map(plainLine).filter(l => l.length >= 4) },
    { where: 'recording', bonus: 0, parts: sentences(e.transcript) },
    { where: 'original', bonus: 0, parts: sentences(e.source_text) }];
  for (const file of db.prepare(`SELECT id, name, extracted_text FROM entry_files WHERE entry_id = ? AND extracted_text != ''`).all(f.entry_id)) {
    pools.push({ where: 'file', file_id: file.id, file_name: file.name, bonus: 0, parts: sentences(file.extracted_text) });
  }
  // Words that show up all over the note (the project name, "budget") say little about where an
  // ask came from; rare ones say a lot. Weight each word by how few passages use it.
  const all = pools.flatMap(pool => pool.parts.map(part => keySet(part)));
  const df = new Map();
  for (const ks of all) for (const k of ks) if (want.has(k)) df.set(k, (df.get(k) || 0) + 1);
  const weight = k => Math.log(1 + all.length / (df.get(k) || 0.5));
  const total = [...want].reduce((n, k) => n + weight(k), 0);
  let best = null;
  for (const pool of pools) {
    const keys = pool.parts.map(part => keySet(part));
    pool.parts.forEach((part, i) => {
      // One passage, or it plus the next one or two (a synthesized ask often spans a few lines).
      for (let span = 1; span <= 3 && i + span <= pool.parts.length; span++) {
        const have = new Set(keys.slice(i, i + span).flatMap(k => [...k]));
        let hits = 0, w = 0;
        for (const k of want) if (have.has(k)) { hits++; w += weight(k); }
        if (!hits) continue;
        const len = pool.parts.slice(i, i + span).join(' ').length;
        const score = w / total * 10 + pool.bonus - (span - 1) * 0.8 - Math.min(1.5, len / 500);
        if (!best || score > best.score) best = { score, hits, cover: w / total, pool, i, span };
      }
    });
  }
  if (!best || best.hits < Math.min(2, want.size)) {
    const a = safeJson(e.analysis, null);
    return a?.action_items?.length ? { ...empty, where: 'reflection' } : empty;
  }
  const { pool, i, span } = best;
  let quote = pool.parts.slice(i, i + span).join(pool.where === 'note' ? '\n' : ' ');
  // A short sentence reads better with the one after it ("Sounds good. I'll send it Friday.").
  if (span === 1 && pool.where !== 'note' && quote.length < 50 && pool.parts[i + 1]) quote = `${quote} ${pool.parts[i + 1]}`;
  return { entry_id: f.entry_id, text: f.text, where: pool.where, file_id: pool.file_id || null, file_name: pool.file_name || null,
    quotes: pool.where === 'note' ? pool.parts.slice(i, i + span) : [quote],
    quote: quote.slice(0, 600), confident: best.cover >= 0.5 };
}

// ---------- quick add: type or say a few to-dos at once ----------
const QUICK_SYSTEM = (today, people) => `You turn a busy manager's quick list of to-dos into separate follow-up items. They typed or said them in a hurry.

Today is ${today}.
People they work with: ${people.length ? people.map(p => p.name).join(', ') : '(none listed)'}

For each distinct task:
- "text": the task as a short action, in their words, cleaned up (no filler like "um" or "I need to"). Under 120 characters.
- "person": who it's with or about, using the exact name from the list when one matches, else "".
- "mine": true if the manager has to do it; false if they're waiting on someone else ("Sam owes me the budget").
- "due": the day as YYYY-MM-DD when they gave one ("Friday", "tomorrow", "by the 30th"), else "".

Split run-on speech into separate tasks. Don't invent tasks or details. Return JSON only: {"items":[{"text":"...","person":"","mine":true,"due":""}]}`;

/** Lines, bullets or semicolons: the fallback when there's no AI to split them. */
const splitLines = text => String(text).split(/\n+|;\s*/).map(s => s.replace(/^\s*(?:[•*-]|\d+[.)])\s+/, '').trim()).filter(s => s.length > 1);

export async function quickAdd(text, { complete, hasAI }) {
  const raw = String(text || '').trim().slice(0, 4000);
  if (!raw) throw Object.assign(new Error('Write or say what you need to do.'), { status: 400 });
  const people = db.prepare('SELECT id, name FROM people ORDER BY name').all();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'America/New_York', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let items = null;
  if (hasAI) {
    try {
      const out = await complete({ system: QUICK_SYSTEM(today, people), messages: [{ role: 'user', content: raw }], json: true, maxTokens: 1200, task: 'quick add' });
      items = (Array.isArray(out?.items) ? out.items : []).filter(i => String(i?.text || '').trim());
    } catch { items = null; }
  }
  if (!items?.length) items = splitLines(raw).map(t => ({ text: t, person: '', mine: true, due: '' }));
  const byName = n => { const x = norm(n); return x ? people.find(p => norm(p.name) === x) || people.find(p => norm(p.name).split(' ')[0] === x.split(' ')[0]) : null; };
  const ins = db.prepare(`INSERT INTO followups(id, entry_id, person_id, text, owner, due, source, created_at) VALUES (?, NULL, ?, ?, ?, ?, 'manual', ?)`);
  const ids = [];
  db.transaction(() => {
    for (const i of items.slice(0, 20)) {
      const p = byName(i.person);
      const mine = i.mine !== false || !p;
      const id = newId();
      ins.run(id, p?.id || null, String(i.text).trim().slice(0, 500), mine ? 'me' : p.name, /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? i.due : '', now());
      ids.push(id);
    }
  })();
  const open = listFollowups({ status: 'open', limit: 1000 });
  return { ids, added: ids.map(id => open.find(f => f.id === id)).filter(Boolean) };
}

/** Take back a quick add (only items you added by hand and haven't touched). */
export function undoQuickAdd(ids = []) {
  const del = db.prepare(`DELETE FROM followups WHERE id = ? AND source = 'manual' AND entry_id IS NULL`);
  let n = 0;
  db.transaction(() => { for (const id of ids.slice(0, 50)) n += del.run(String(id)).changes; })();
  return { removed: n };
}
