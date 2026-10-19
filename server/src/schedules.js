// Recurring conversations: a simple, calendar-free schedule for 1:1s and small group check-ins.
// Each schedule has a cadence (weekly, every N weeks, monthly on the same weekday, or once)
// and per-date exceptions for when one is moved or cancelled.
import { db, safeJson } from './db.js';

// ---------- pure date helpers (calendar dates as YYYY-MM-DD, no timezone surprises) ----------
const toDays = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const fromDays = n => new Date(n * 864e5).toISOString().slice(0, 10);
const weekday = ymd => new Date(toDays(ymd) * 864e5).getUTCDay();
const addDays = (ymd, n) => fromDays(toDays(ymd) + n);

/** The local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock date + time in a timezone → UTC Date (handles daylight saving). */
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = t => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass for DST boundaries
  return new Date(t);
}

/** Occurrence dates of one schedule between two local dates (inclusive). */
export function occurrenceDates(s, fromYmd, toYmd) {
  const out = [];
  if (s.frequency === 'once') {
    if (s.anchor_date >= fromYmd && s.anchor_date <= toYmd) out.push(s.anchor_date);
    return out;
  }
  if (s.frequency === 'monthly') {
    // Same weekday, same week-of-month as the anchor (5th → last).
    const aDay = Number(s.anchor_date.slice(8, 10));
    const nth = Math.ceil(aDay / 7);
    const wd = weekday(s.anchor_date);
    let [y, m] = fromYmd.split('-').map(Number);
    for (let i = 0; i < 4; i++) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      const firstWd = weekday(first);
      let day = 1 + ((wd - firstWd + 7) % 7) + (nth - 1) * 7;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (day > dim) day -= 7; // "5th" → last one in the month
      const ymd = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (ymd >= fromYmd && ymd <= toYmd && ymd >= s.anchor_date) out.push(ymd);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  // weekly / every N weeks
  const step = 7 * Math.max(1, Number(s.interval_weeks) || 1);
  const a = toDays(s.anchor_date);
  let k = Math.ceil((toDays(fromYmd) - a) / step);
  for (let d = a + k * step; d <= toDays(toYmd); d += step, k++) out.push(fromDays(d));
  return out;
}

const keyOf = (id, ymd) => `sched:${id}:${ymd}`;
export const parseKey = key => {
  const m = /^sched:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(key || ''));
  return m ? { id: m[1], date: m[2] } : null;
};

function hydrate(row, peopleById) {
  const ids = safeJson(row.people, []);
  return {
    ...row,
    active: !!row.active,
    people: ids.map(id => peopleById[id]).filter(Boolean).map(p => ({ id: p.id, name: p.name, photo: p.photo, relationship: p.relationship, city: p.city || '', tz: p.tz || '' }))
  };
}

const titleFor = s => s.title?.trim() || (s.people.length === 1 ? `1:1 with ${s.people[0].name.split(' ')[0]}` : `Check-in with ${s.people.map(p => p.name.split(' ')[0]).join(', ')}`);

/**
 * All occurrences across schedules in a window, with moves and cancellations applied.
 * Includes cancelled ones (status: 'skipped') so they can be undone.
 */
export function occurrences({ people, from = new Date(Date.now() - 12 * 3600e3), days = 7, scheduleId = null } = {}) {
  const peopleById = Object.fromEntries(people.map(p => [p.id, p]));
  const rows = db.prepare(`SELECT * FROM schedules WHERE active = 1 ${scheduleId ? 'AND id = ?' : ''}`).all(...(scheduleId ? [scheduleId] : []));
  const to = new Date(from.getTime() + days * 864e5 + 12 * 3600e3);
  const exQ = db.prepare('SELECT * FROM schedule_exceptions WHERE schedule_id = ?');
  const out = [];
  for (const row of rows) {
    const s = hydrate(row, peopleById);
    if (!s.people.length) continue;
    const ex = Object.fromEntries(exQ.all(s.id).map(e => [e.date, e]));
    // Look a little wider than the window so a moved occurrence can land inside it.
    const dates = occurrenceDates(s, addDays(localDate(from, s.tz), -14), addDays(localDate(to, s.tz), 14));
    for (const ymd of dates) {
      const e = ex[ymd];
      const original = zonedToUtc(ymd, s.time, s.tz);
      const start = e?.action === 'move' && e.new_start ? new Date(e.new_start) : original;
      if (start < from || start > to) continue;
      out.push({
        key: keyOf(s.id, ymd),
        source: 'schedule',
        schedule_id: s.id,
        date: ymd,
        title: titleFor(s),
        start: start.toISOString(),
        end: new Date(start.getTime() + s.duration_min * 60e3).toISOString(),
        all_day: false,
        people: s.people,
        status: e?.action === 'skip' ? 'skipped' : e?.action === 'move' ? 'moved' : null,
        original_start: e?.action === 'move' ? original.toISOString() : null
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function findOccurrence(key, people) {
  const k = parseKey(key);
  if (!k) return null;
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(k.id);
  if (!row) return null;
  const s = hydrate(row, Object.fromEntries(people.map(p => [p.id, p])));
  const e = db.prepare('SELECT * FROM schedule_exceptions WHERE schedule_id = ? AND date = ?').get(s.id, k.date);
  const start = e?.action === 'move' && e.new_start ? new Date(e.new_start) : zonedToUtc(k.date, s.time, s.tz);
  return { key, title: titleFor(s), start: start.toISOString(), people: s.people };
}

export function listSchedules(people) {
  const peopleById = Object.fromEntries(people.map(p => [p.id, p]));
  const now = new Date();
  return db.prepare('SELECT * FROM schedules ORDER BY created_at').all().map(row => {
    const s = hydrate(row, peopleById);
    const next = occurrences({ people, from: now, days: 120, scheduleId: s.id }).filter(o => o.status !== 'skipped').slice(0, 3);
    return { ...s, display_title: titleFor(s), next: next.map(o => ({ start: o.start, status: o.status, key: o.key })) };
  });
}
