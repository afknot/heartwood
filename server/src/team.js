// Your team this week: how each person seemed to you, their rhythm, and who might need you.
//
//   reads    after a conversation you can note how someone seemed: Good, Okay or Carrying something.
//            It's your read, kept private, never Heartwood's guess about anyone's feelings.
//   rhythm   how often you usually meet (from recurring 1:1s and meeting series). Someone on a
//            two-week rhythm isn't "missed" in their off week.
//   needs    who might need you, always with the reasons, built only from what you wrote and marked.
import { db, newId, now, listPeople, getSettings } from './db.js';
import { meetingSeries } from './calendar.js';
import { listFollowups } from './followups.js';
import { latestGrowth } from './briefs.js';
import { local, weekOf, startOfLocalDay, addDays } from './localtime.js';

export const READS = { good: 'Good', okay: 'Okay', carrying: 'Carrying something' };
const DAY = 864e5;

export function saveRead({ personId, read, note = '', entryId = null }) {
  if (!READS[read]) throw Object.assign(new Error('Pick Good, Okay or Carrying something.'), { status: 400 });
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId)) throw Object.assign(new Error('Not found'), { status: 404 });
  // One read per person per day: a second tap the same day replaces the first.
  const ymd = local().ymd;
  const today = db.prepare('SELECT id, at FROM person_reads WHERE person_id = ? ORDER BY at DESC LIMIT 1').get(personId);
  if (today && local(new Date(today.at)).ymd === ymd) {
    db.prepare('UPDATE person_reads SET read = ?, note = ?, entry_id = COALESCE(?, entry_id), at = ? WHERE id = ?').run(read, String(note).slice(0, 200), entryId, now(), today.id);
  } else {
    db.prepare('INSERT INTO person_reads(id, person_id, entry_id, read, note, at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), personId, entryId, read, String(note).slice(0, 200), now());
  }
  return readsFor(personId);
}

export function clearTodayRead(personId) {
  const r = db.prepare('SELECT id, at FROM person_reads WHERE person_id = ? ORDER BY at DESC LIMIT 1').get(personId);
  if (r && local(new Date(r.at)).ymd === local().ymd) db.prepare('DELETE FROM person_reads WHERE id = ?').run(r.id);
  return readsFor(personId);
}

/** The last 8 weeks for one person: the latest read in each week (null where there was none). */
export function readsFor(personId, weeks = 8) {
  const rows = db.prepare('SELECT read, note, at FROM person_reads WHERE person_id = ? AND at >= ? ORDER BY at').all(personId, new Date(Date.now() - (weeks * 7 + 7) * DAY).toISOString());
  const byWeek = new Map();
  for (const r of rows) byWeek.set(weekOf(new Date(r.at)), r);
  const out = [];
  for (let i = weeks - 1, w = weekOf(); i >= 0; i--) {
    const wk = addDays(w, -7 * i);
    const r = byWeek.get(wk);
    out.push({ week: wk, read: r?.read || null, note: r?.note || '', at: r?.at || null });
  }
  return { weeks: out, latest: rows.at(-1) || null };
}

// "Weekly", "Every 2 weeks on Tue", "Monthly", "About every 10 days" -> weeks between meetings
function cadenceWeeks(text = '') {
  const t = String(text).toLowerCase();
  if (/daily|weekly/.test(t) && !/every \d+ weeks/.test(t)) return 1;
  const w = t.match(/every (\d+) weeks/); if (w) return Number(w[1]);
  if (/month/.test(t)) return 4;
  const d = t.match(/every (\d+) days/); if (d) return Math.max(1, Math.round(Number(d[1]) / 7));
  return null;
}

/** How often you usually meet each person, in weeks (1 when there's nothing regular). */
function rhythms(people) {
  const out = new Map();
  const set = (id, w) => { if (w && (!out.has(id) || w < out.get(id))) out.set(id, w); };
  for (const s of db.prepare('SELECT people, frequency, interval_weeks FROM schedules WHERE active = 1').all()) {
    let ids = []; try { ids = JSON.parse(s.people || '[]'); } catch { /* bad row */ }
    const w = s.frequency === 'monthly' ? 4 : s.frequency === 'weekly' ? (s.interval_weeks || 1) : null;
    for (const id of ids) set(id, w);
  }
  try {
    for (const m of meetingSeries({ people, myName: getSettings().profile?.name })) {
      if (!m.recurring) continue;
      for (const p of m.people || []) set(p.id, cadenceWeeks(m.cadence));
    }
  } catch { /* calendar unavailable */ }
  return out;
}

const pron = p => {
  const v = String(p.pronouns || 'they/them').toLowerCase();
  if (v.startsWith('she')) return { obj: 'her', subj: 'she', pos: 'her' };
  if (v.startsWith('he')) return { obj: 'him', subj: 'he', pos: 'his' };
  if (v.startsWith('they')) return { obj: 'them', subj: 'they', pos: 'their' };
  const first = p.name.split(' ')[0];
  return { obj: first, subj: first, pos: `${first}’s` };
};

const dismissKey = id => `team_dismissed:${id}`;
export function dismissNeeds(personId) {
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(dismissKey(personId), JSON.stringify(weekOf()));
}
const dismissedThisWeek = id => { try { return JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(dismissKey(id))?.value || 'null') === weekOf(); } catch { return false; } };

/**
 * Reasons someone might need you, each with a next step. Only from what you wrote and marked.
 * Steps: { label, kind: 'agenda' | 'prep' | 'kudos' | 'followup', followup_id? }
 */
function needs(p, ctx) {
  const first = p.name.split(' ')[0];
  const { obj, pos } = pron(p);
  const reasons = [], steps = [];
  let attention = false; // a worry, an overdue promise or a long gap (not just a win to celebrate)
  const recent = db.prepare('SELECT read FROM person_reads WHERE person_id = ? ORDER BY at DESC LIMIT 3').all(p.id).map(r => r.read);
  const carrying = recent.findIndex(r => r !== 'carrying');
  const streak = carrying === -1 ? recent.length : carrying;
  if (streak >= 2) reasons.push(`You marked ${obj} Carrying something after your last ${streak} conversations.`);
  else if (streak === 1) reasons.push(`You marked ${obj} Carrying something last time.`);
  if (streak >= 1) attention = true;
  if (streak >= 1) {
    steps.push({ label: `Build your next agenda: start with how ${first} is doing`, kind: 'agenda' });
    steps.push({ label: `Ask what you could take off ${pos} plate`, kind: 'prep' });
  }
  const owed = ctx.open.filter(f => f.mine && f.person_id === p.id && f.reasons?.some(r => r.kind === 'due' && /^Was due|ASAP/.test(r.label)));
  if (owed.length) {
    attention = true;
    const f = owed[0];
    const due = f.reasons.find(r => r.kind === 'due')?.label.replace(/^Was due/, 'due').replace(/^ASAP/, 'needed ASAP');
    reasons.push(`You owe ${obj}: ${f.text}${due ? ` (${due})` : ''}.`);
    steps.unshift({ label: f.text.length > 60 ? `${f.text.slice(0, 57)}…` : f.text, kind: 'followup', followup_id: f.id });
  }
  try {
    const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    const win = (latestGrowth(p.id)?.timeline || []).filter(t => (t.type === 'win' || t.type === 'milestone') && t.date && t.date >= since).at(-1);
    if (win && !db.prepare(`SELECT 1 FROM career_drafts WHERE kind = 'recognition' AND title LIKE ? AND created_at >= ?`).get(`%${p.name}%`, `${win.date}T00:00:00Z`)) {
      reasons.push(`${first}: ${win.text.length > 90 ? `${win.text.slice(0, 87)}…` : win.text}. No kudos yet.`);
      steps.push({ label: `Give ${first} kudos`, kind: 'kudos' });
    }
  } catch { /* no growth record */ }
  const gapDays = p.last_seen ? Math.floor((Date.now() - Date.parse(p.last_seen)) / DAY) : null;
  if (gapDays !== null && gapDays > p.rhythm * 7 + 7) {
    attention = true;
    reasons.push(`It’s been ${Math.round(gapDays / 7)} weeks since you last talked, longer than your usual ${p.rhythm === 1 ? 'week' : `${p.rhythm} weeks`}.`);
    steps.push({ label: `Prep a check-in with ${first}`, kind: 'prep' });
  }
  const headline = !reasons.length ? '' : attention ? `${first} might need you` : `${first} has a win to recognize`;
  return { reasons: reasons.slice(0, 3), steps: steps.slice(0, 3), headline };
}

/** Your direct reports this week: seen, how they seemed, rhythm, and who might need you. */
export function teamWeek({ agendaFn }) {
  const people = listPeople();
  const reports = people.filter(p => p.relationship === 'direct_report');
  if (!reports.length) return { week: weekOf(), people: [], ask: [] };
  const monday = weekOf();
  const from = startOfLocalDay(monday);
  const ymd = local().ymd;
  const rhythm = rhythms(people);

  // Time together: notes about them, and conversations that have happened (this week, and the last one ever).
  const seen = new Map(), last = new Map();
  const mark = (map, id, at, how) => { const prev = map.get(id); if (!prev || at > prev.at) map.set(id, { at, how }); };
  for (const r of db.prepare(`SELECT ep.person_id, MAX(e.created_at) AS at FROM entry_people ep JOIN entries e ON e.id = ep.entry_id GROUP BY ep.person_id`).all()) mark(last, r.person_id, r.at, 'note');
  for (const r of db.prepare(`SELECT ep.person_id, e.created_at, e.kind FROM entry_people ep JOIN entries e ON e.id = ep.entry_id WHERE e.created_at >= ?`).all(from.toISOString())) {
    mark(seen, r.person_id, r.created_at, ['one_on_one', 'conversation', 'meeting'].includes(r.kind) ? 'conversation' : 'note');
  }
  const todayTalks = [];
  try {
    const days = Math.round((Date.now() - from.getTime()) / DAY) + 1;
    for (const ev of agendaFn({ days, from })) {
      if (ev.status === 'skipped' || Date.parse(ev.start) > Date.now()) continue;
      for (const p of ev.people) { mark(seen, p.id, ev.start, 'conversation'); mark(last, p.id, ev.start, 'conversation'); }
      if (local(new Date(ev.start)).ymd === ymd) todayTalks.push(ev);
    }
  } catch { /* calendar unavailable: notes still count */ }

  const open = listFollowups({ status: 'open', limit: 3000 });
  const latestRead = db.prepare('SELECT read, at FROM person_reads WHERE person_id = ? ORDER BY at DESC LIMIT 1');
  const list = reports.map(p => {
    const s = seen.get(p.id), r = latestRead.get(p.id);
    const weeks = rhythm.get(p.id) || 1;
    const lastAt = last.get(p.id)?.at || p.last_entry_at || null;
    // On rhythm: seen this week, or within their usual gap (someone you meet every 2 weeks isn't missed in the off week).
    const onRhythm = !!s || (weeks > 1 && lastAt && Date.now() - Date.parse(lastAt) < weeks * 7 * DAY);
    const person = { id: p.id, name: p.name, photo: p.photo, pronouns: p.pronouns, rhythm: weeks, covered: !!s, on_rhythm: onRhythm, at: s?.at || null, how: s?.how || null, last_seen: lastAt,
      read: r && Date.now() - Date.parse(r.at) < 21 * DAY ? r.read : null, read_at: r?.at || null };
    const n = dismissedThisWeek(p.id) ? { reasons: [], steps: [], headline: '' } : needs({ ...p, ...person }, { open });
    return { ...person, needs: n.reasons, steps: n.steps, headline: n.headline };
  });

  // "How did they seem?": people you talked with today (conversations that are over, or 1:1 notes from
  // today) without a read yet today.
  const readToday = id => { const r = latestRead.get(id); return r && local(new Date(r.at)).ymd === ymd; };
  const ask = [];
  for (const r of db.prepare(`SELECT ep.person_id, e.title, e.created_at FROM entry_people ep JOIN entries e ON e.id = ep.entry_id WHERE e.kind IN ('one_on_one', 'conversation') AND e.created_at >= ?`).all(startOfLocalDay(ymd).toISOString())) {
    todayTalks.push({ title: r.title || '1:1', start: r.created_at, people: [{ id: r.person_id }] });
  }
  for (const ev of todayTalks) {
    for (const p of ev.people) {
      const rep = list.find(x => x.id === p.id);
      if (rep && !readToday(p.id) && !ask.some(a => a.id === p.id)) ask.push({ id: rep.id, name: rep.name, photo: rep.photo, event_title: ev.title, start: ev.start });
    }
  }
  return { week: monday, today: ymd, people: list, ask: ask.slice(0, 3) };
}
