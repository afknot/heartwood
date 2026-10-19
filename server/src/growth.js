// Growth rings and team coverage for Today.
//
// Rings: each week is five marks, Monday the heartwood dot at the center and Tuesday to Friday the
// rings around it. A day's mark is thicker the more you put in (notes, conversations, end-of-day
// reflections, follow-ups closed, kudos, practices tried). A quiet day is a fine line, never a gap.
//
// Coverage: your direct reports this week, filled in once you've had time with each (a conversation
// that's happened, or a note about them). It starts fresh each Monday.
import { db, listPeople } from './db.js';
import { agenda } from './agenda.js';
import { local, weekOf, startOfLocalDay, addDays } from './localtime.js';

const CONVERSATION = new Set(['one_on_one', 'conversation', 'meeting']);
const isEod = tags => { try { return JSON.parse(tags || '[]').includes('end-of-day'); } catch { return false; } };

/** Weekly rings, oldest first, plus this week's tally. */
export function growthRings({ maxWeeks = 104 } = {}) {
  const weeks = new Map();
  const blank = w => ({ week: w, notes: 0, conversations: 0, reflections: 0, followups: 0, kudos: 0, practices: 0, days: [0, 0, 0, 0, 0] });
  const bump = (iso, k, n = 1) => {
    if (!iso) return;
    const at = new Date(iso);
    const w = weekOf(at);
    if (!weeks.has(w)) weeks.set(w, blank(w));
    const t = weeks.get(w);
    t[k] += n;
    // Which of the five workday rings it grows: Monday (the center) to Friday; weekends count toward Friday.
    const wd = new Date(`${local(at).ymd}T12:00:00Z`).getUTCDay();
    t.days[Math.min(4, (wd + 6) % 7)] += n;
  };
  for (const e of db.prepare('SELECT created_at, kind, tags, title FROM entries').all()) {
    if (isEod(e.tags) || /^End of day/.test(e.title || '')) bump(e.created_at, 'reflections');
    else if (CONVERSATION.has(e.kind)) bump(e.created_at, 'conversations');
    else bump(e.created_at, 'notes');
  }
  for (const f of db.prepare('SELECT COALESCE(done_at, let_go_at) AS at FROM followups WHERE done_at IS NOT NULL OR let_go_at IS NOT NULL').all()) bump(f.at, 'followups');
  for (const d of db.prepare(`SELECT created_at FROM career_drafts WHERE kind = 'recognition'`).all()) bump(d.created_at, 'kudos');
  for (const p of db.prepare('SELECT done_at FROM practice_log WHERE done_at IS NOT NULL').all()) bump(p.done_at, 'practices');

  const thisWeek = weekOf();
  const first = [...weeks.keys()].sort()[0] || thisWeek;
  const all = [];
  for (let w = first; w <= thisWeek; w = addDays(w, 7)) {
    const t = weeks.get(w) || blank(w);
    t.score = t.notes + 2 * t.conversations + 1.5 * t.reflections + 0.5 * t.followups + 2 * t.kudos + 1.5 * t.practices;
    all.push(t);
  }
  const wd = new Date(`${local().ymd}T12:00:00Z`).getUTCDay();
  // today: 0 = Monday … 4 = Friday (and the weekend, which grows Friday's ring).
  return { total_weeks: all.length, weeks: all.slice(-maxWeeks), this_week: all.at(-1), since: first, today: Math.min(4, (wd + 6) % 7) };
}

/** Your direct reports this week: who you've had time with so far. */
export function teamCoverage() {
  const reports = listPeople().filter(p => p.relationship === 'direct_report');
  if (!reports.length) return { week: weekOf(), people: [] };
  const monday = weekOf();
  const from = startOfLocalDay(monday);
  const seen = new Map(); // person id -> { at, how }
  const note = (id, at, how) => { const prev = seen.get(id); if (!prev || at > prev.at) seen.set(id, { at, how }); };

  const rows = db.prepare(`SELECT ep.person_id, e.created_at, e.kind FROM entry_people ep JOIN entries e ON e.id = ep.entry_id WHERE e.created_at >= ?`).all(from.toISOString());
  for (const r of rows) note(r.person_id, r.created_at, CONVERSATION.has(r.kind) ? 'conversation' : 'note');
  try {
    const days = Math.round((Date.now() - from.getTime()) / 864e5) + 1;
    for (const ev of agenda({ days, from })) {
      if (ev.status === 'skipped' || Date.parse(ev.start) > Date.now()) continue;
      for (const p of ev.people) note(p.id, ev.start, 'conversation');
    }
  } catch { /* calendar unavailable: notes still count */ }

  const people = reports.map(p => {
    const s = seen.get(p.id);
    return { id: p.id, name: p.name, photo: p.photo, covered: !!s, at: s?.at || null, how: s?.how || null };
  });
  return { week: monday, today: local().ymd, people };
}
