import { db, newId, now, hydrateEntry, getSettings, listPeople } from './db.js';
import { complete } from './llm.js';
import { personBriefPrompt, growthPrompt, periodReportPrompt } from './prompts.js';

const MAX_CONTEXT_CHARS = 180000;

/** Keep the newest entries that fit in the context budget. */
export function fitToBudget(entries, perEntry) {
  let total = 0;
  const kept = [];
  for (const e of [...entries].reverse()) {
    total += Math.min(perEntry, (e.analysis?.summary?.length || 0) + (e.body_md?.length || 0) + (e.transcript?.length || 0) + 200);
    if (total > MAX_CONTEXT_CHARS) break;
    kept.unshift(e);
  }
  return kept;
}

export class BriefError extends Error {}

export async function createPersonBrief(personId) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) throw new BriefError('Not found');
  const rows = db.prepare(`SELECT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at ASC`).all(person.id);
  if (!rows.length) throw new BriefError(`No entries are linked to ${person.name} yet.`);
  const entries = fitToBudget(rows.map(r => hydrateEntry(r)), 3200);
  const s = getSettings();
  const { system, messages } = personBriefPrompt({ person, entries, profile: s.profile, people: listPeople() });
  const content = await complete({ system, messages, maxTokens: 4000 });
  const id = newId();
  db.prepare(`INSERT INTO reports(id, kind, person_id, title, content_md, entry_count, created_at) VALUES (?, 'person', ?, ?, ?, ?, ?)`)
    .run(id, person.id, `Brief: ${person.name}`, content, entries.length, now());
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}

// ---------- growth record (kind 'growth'; content_md holds the JSON) ----------
const TYPES = ['win', 'concern', 'feedback', 'milestone', 'goal'];
const STATUSES = ['active', 'achieved', 'dropped', 'unclear'];
const ymd = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

export async function createGrowth(personId) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) throw new BriefError('Not found');
  if (person.relationship !== 'direct_report') throw new BriefError('Growth records are for your direct reports. Set the relationship to Direct report to build one.');
  const rows = db.prepare(`SELECT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at ASC`).all(person.id);
  if (!rows.length) throw new BriefError(`No entries are linked to ${person.name} yet.`);
  const entries = fitToBudget(rows.map(r => hydrateEntry(r)), 2800);
  const known = new Map(entries.map(e => [e.id, e]));
  const s = getSettings();
  const { system, messages } = growthPrompt({ person, entries, profile: s.profile, people: listPeople() });
  const g = await complete({ system, messages, json: true, maxTokens: 7000 });
  // Keep only well-formed items that cite real entries.
  const clean = {
    summary: String(g?.summary || '').slice(0, 1200),
    goals: (Array.isArray(g?.goals) ? g.goals : []).slice(0, 15).map(x => ({
      goal: String(x.goal || '').slice(0, 300), status: STATUSES.includes(x.status) ? x.status : 'unclear',
      first_seen: ymd(x.first_seen), last_seen: ymd(x.last_seen), progress: String(x.progress || '').slice(0, 300),
      entry_ids: (Array.isArray(x.entry_ids) ? x.entry_ids : []).filter(id => known.has(id)).slice(0, 6)
    })).filter(x => x.goal),
    timeline: (Array.isArray(g?.timeline) ? g.timeline : []).slice(0, 60).map(x => {
      const e = known.get(x.entry_id);
      return { date: ymd(x.date) || (e ? e.created_at.slice(0, 10) : null), type: TYPES.includes(x.type) ? x.type : 'milestone',
        text: String(x.text || '').slice(0, 400), entry_id: e ? e.id : null, entry_title: e ? (e.title || 'note') : null };
    }).filter(x => x.text && x.date).sort((a, b) => a.date.localeCompare(b.date)),
    strengths: (Array.isArray(g?.strengths) ? g.strengths : []).map(String).slice(0, 8),
    growth_areas: (Array.isArray(g?.growth_areas) ? g.growth_areas : []).map(String).slice(0, 8),
    review_notes: String(g?.review_notes || '').slice(0, 6000),
    covers: { from: entries[0]?.created_at.slice(0, 10), to: entries.at(-1)?.created_at.slice(0, 10) }
  };
  const id = newId();
  db.prepare(`INSERT INTO reports(id, kind, person_id, title, content_md, entry_count, created_at) VALUES (?, 'growth', ?, ?, ?, ?, ?)`)
    .run(id, person.id, `Growth: ${person.name}`, JSON.stringify(clean), entries.length, now());
  return { id, created_at: now(), entry_count: entries.length, ...clean };
}

export function latestGrowth(personId) {
  const r = db.prepare(`SELECT * FROM reports WHERE kind = 'growth' AND person_id = ? ORDER BY created_at DESC LIMIT 1`).get(personId);
  if (!r) return null;
  try { return { id: r.id, created_at: r.created_at, entry_count: r.entry_count, ...JSON.parse(r.content_md) }; } catch { return null; }
}

// ---------- debriefs over a period (kind 'period') ----------
export async function createPeriodReport({ fromIso, toIso, from, to, focus = '' }) {
  const rows = db.prepare('SELECT * FROM entries WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC').all(fromIso, toIso);
  if (!rows.length) throw new BriefError('No entries in that range yet.');
  const entries = fitToBudget(rows.map(r => hydrateEntry(r)), 2700);
  const s = getSettings();
  const { system, messages } = periodReportPrompt({ entries, profile: s.profile, people: listPeople(), from, to, focus: String(focus).slice(0, 1500) });
  const content = await complete({ system, messages, maxTokens: 5000 });
  const id = newId();
  const title = focus ? `${from} → ${to}: ${String(focus).slice(0, 60)}` : `${from} → ${to}`;
  db.prepare(`INSERT INTO reports(id, kind, title, range_from, range_to, focus, content_md, entry_count, created_at) VALUES (?, 'period', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, title, from, to, focus, content, entries.length, now());
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}
