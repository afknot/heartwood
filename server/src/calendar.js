// Read-only calendar sync from a private ICS feed URL (Google: "Secret address in iCal format";
// Outlook: "Publish calendar → ICS"). Fetched by your server only; nothing is written back.
import { db } from './db.js';
import { expandIcs } from './ics.js';
import { safeFetch } from './netguard.js';

db.exec(`CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

const WINDOW_PAST_H = 12;
const WINDOW_DAYS = 14;
const state = { lastSync: null, error: null, syncing: false };

const getSecret = k => db.prepare('SELECT value FROM secrets WHERE key = ?').get(k)?.value || null;
const setSecret = (k, v) => v == null
  ? db.prepare('DELETE FROM secrets WHERE key = ?').run(k)
  : db.prepare('INSERT INTO secrets(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

export function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:\/\//i, 'https://');
  let url;
  try { url = new URL(u); } catch { throw new Error('That doesn’t look like a calendar link.'); }
  if (url.protocol !== 'https:') throw new Error('Use the https:// (or webcal://) calendar link.');
  return url.toString();
}

export function calendarStatus() {
  const url = getSecret('calendar_url');
  return {
    connected: !!url,
    host: url ? new URL(url).hostname : null,
    last_sync: state.lastSync,
    error: state.error,
    events: db.prepare('SELECT COUNT(*) n FROM calendar_events').get().n
  };
}

export async function connectCalendar(raw) {
  const url = normalizeUrl(raw);
  const events = await fetchEvents(url); // validate before saving
  setSecret('calendar_url', url);
  store(events);
  return calendarStatus();
}

export function disconnectCalendar() {
  setSecret('calendar_url', null);
  db.prepare('DELETE FROM calendar_events').run();
  state.lastSync = null; state.error = null;
}

export async function syncCalendar() {
  const url = getSecret('calendar_url');
  if (!url || state.syncing) return;
  state.syncing = true;
  try { store(await fetchEvents(url)); state.error = null; }
  catch (err) { state.error = err.message; console.error('[calendar]', err.message); }
  finally { state.syncing = false; }
}

export function startCalendarSync() {
  syncCalendar();
  setInterval(syncCalendar, 15 * 60 * 1000).unref();
}

function store(events) {
  db.transaction(() => {
    db.prepare('DELETE FROM calendar_events').run();
    const ins = db.prepare(`INSERT OR REPLACE INTO calendar_events(key, uid, title, start, end, all_day, location, attendees) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of events) ins.run(e.key, e.uid, e.title, e.start, e.end, e.all_day ? 1 : 0, e.location, JSON.stringify(e.attendees));
  })();
  state.lastSync = new Date().toISOString();
}

async function fetchEvents(url) {
  const res = await safeFetch(url, { timeoutMs: 20000, maxBytes: 15 * 1024 * 1024, headers: { accept: 'text/calendar, */*' } });
  if (!res.ok) throw new Error(`The calendar link returned ${res.status}. Check that it’s the private/secret address.`);
  const text = await res.text();
  if (text.length > 15 * 1024 * 1024) throw new Error('That calendar is too large to read.');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link didn’t return a calendar (ICS) file.');
  return parseEvents(text);
}

/** Expand events (including recurring ones) into occurrences within the window. */
export async function parseEvents(text, { exclude = [] } = {}) {
  const from = new Date(Date.now() - WINDOW_PAST_H * 3600e3);
  const to = new Date(Date.now() + WINDOW_DAYS * 864e5);
  return expandIcs(text, { from, to, exclude });
}

const brief = p => ({ id: p.id, name: p.name, photo: p.photo, relationship: p.relationship, city: p.city || '', tz: p.tz || '' });

/** People you've set by hand for a meeting series (uid), or null to match automatically. */
export function peopleOverride(uid, people) {
  const row = db.prepare('SELECT people FROM event_people WHERE uid = ?').get(uid);
  if (!row) return null;
  let ids = [];
  try { ids = JSON.parse(row.people); } catch { /* bad row */ }
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  return ids.map(id => byId[id]).filter(Boolean).map(brief);
}

/** One meeting series, for the "who's in this" sheet: people now, and attendee names (no addresses). */
export function meetingDetail(uid, people, myName = '') {
  const e = db.prepare(`SELECT * FROM (SELECT * FROM calendar_events WHERE uid = ? UNION ALL SELECT * FROM invite_events WHERE uid = ?)
    ORDER BY CASE WHEN start >= ? THEN 0 ELSE 1 END, start LIMIT 1`).get(uid, uid, new Date().toISOString());
  const inv = e ? null : db.prepare(`SELECT title FROM invites WHERE uid = ? LIMIT 1`).get(uid);
  if (!e && !inv) return null;
  const attendees = e ? JSON.parse(e.attendees || '[]') : [];
  const ev = { title: e?.title || inv.title, attendees };
  const override = peopleOverride(uid, people);
  const auto = matchPeople(ev, people, myName);
  const byEmail = Object.fromEntries(people.filter(p => p.email).map(p => [p.email.toLowerCase(), p.id]));
  const me = norm(myName);
  return {
    uid,
    title: ev.title,
    start: e?.start || null,
    people: override || auto,
    set_by_hand: !!override,
    attendees: attendees.map((a, i) => ({ i, name: a.name || 'Unnamed attendee', person_id: byEmail[a.email] || null }))
      .filter(a => norm(a.name) !== me)
  };
}

/** "This attendee is <person>": saves their invite address on the person so future meetings match. */
export function linkAttendee(uid, index, personId) {
  const e = db.prepare(`SELECT attendees FROM calendar_events WHERE uid = ? UNION ALL SELECT attendees FROM invite_events WHERE uid = ? LIMIT 1`).get(uid, uid);
  const a = e ? JSON.parse(e.attendees || '[]')[Number(index)] : null;
  if (!a?.email) throw new Error('That attendee has no email address on the invite.');
  const p = db.prepare('SELECT id, email FROM people WHERE id = ?').get(personId);
  if (!p) throw new Error('Pick a person.');
  db.prepare('UPDATE people SET email = ? WHERE id = ?').run(a.email, p.id);
  // If you've set people by hand for this meeting, include them there too.
  const row = db.prepare('SELECT people FROM event_people WHERE uid = ?').get(uid);
  if (row) {
    const ids = new Set(JSON.parse(row.people || '[]')); ids.add(p.id);
    db.prepare('UPDATE event_people SET people = ?, updated_at = ? WHERE uid = ?').run(JSON.stringify([...ids]), new Date().toISOString(), uid);
  }
  return { replaced_email: !!(p.email && p.email !== a.email) };
}

export function setMeetingPeople(uid, ids) {
  if (ids == null) return db.prepare('DELETE FROM event_people WHERE uid = ?').run(uid);
  const valid = ids.filter(id => db.prepare('SELECT 1 FROM people WHERE id = ?').get(id));
  db.prepare(`INSERT INTO event_people(uid, people, updated_at) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET people = excluded.people, updated_at = excluded.updated_at`)
    .run(uid, JSON.stringify(valid), new Date().toISOString());
}

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Which of your people are in this event? Matches attendee email, attendee name, or a name in the title. */
export function matchPeople(ev, people, myName = '') {
  const me = norm(myName);
  const title = ` ${norm(ev.title)} `;
  const hits = new Map();
  const firstCounts = {};
  for (const p of people) { const f = norm(p.name).split(' ')[0]; firstCounts[f] = (firstCounts[f] || 0) + 1; }
  for (const p of people) {
    const name = norm(p.name);
    if (!name || name === me) continue;
    const email = norm(p.email);
    const first = name.split(' ')[0];
    const byEmail = email && ev.attendees.some(a => a.email === email);
    const byAttendeeName = ev.attendees.some(a => norm(a.name) === name);
    const byTitle = title.includes(` ${name} `) || (first.length > 2 && firstCounts[first] === 1 && title.includes(` ${first} `));
    if (byEmail || byAttendeeName || byTitle) hits.set(p.id, brief(p));
  }
  return [...hits.values()];
}

export function upcomingEvents({ people, myName, days = 7, from: since = null } = {}) {
  const from = (since ? new Date(since) : new Date(Date.now() - 2 * 3600e3)).toISOString();
  const to = new Date(Date.now() + days * 864e5).toISOString();
  // Your linked calendar, plus meetings you've invited Heartwood to (shown once if both have it).
  const rows = db.prepare(`SELECT *, 'calendar' AS source FROM calendar_events WHERE start >= ? AND start <= ?
    UNION ALL SELECT *, 'invite' AS source FROM invite_events WHERE start >= ? AND start <= ? AND key NOT IN (SELECT key FROM calendar_events)
    ORDER BY start LIMIT 80`).all(from, to, from, to);
  return rows
    .map(e => {
      const ev = { ...e, all_day: !!e.all_day, attendees: JSON.parse(e.attendees || '[]') };
      ev.people = peopleOverride(ev.uid, people) || matchPeople(ev, people, myName);
      ev.attendee_count = ev.attendees.length;
      delete ev.attendees; // keep other people's addresses on the server
      return ev;
    });
}

// ---------- meeting series ----------
// Meetings from your calendar link and from invites, grouped by series (one row per UID), with how
// often they happen and who's in them. Recurring invites stay as the organizer sends them, so a
// moved or cancelled meeting updates here without a copy in Heartwood drifting out of date.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function cadence(rule, starts) {
  const freq = rule?.match(/FREQ=(\w+)/)?.[1];
  const n = Number(rule?.match(/INTERVAL=(\d+)/)?.[1] || 1);
  const day = starts[0] ? DAYS[new Date(starts[0]).getDay()] : '';
  if (freq === 'DAILY') return n === 1 ? 'Daily' : `Every ${n} days`;
  if (freq === 'WEEKLY') return n === 1 ? `Weekly${day ? ` on ${day}` : ''}` : `Every ${n} weeks${day ? ` on ${day}` : ''}`;
  if (freq === 'MONTHLY') return n === 1 ? 'Monthly' : `Every ${n} months`;
  if (freq === 'YEARLY') return 'Yearly';
  if (starts.length < 2) return '';
  // No rule (a calendar feed already expanded it): infer from the gaps.
  const gaps = starts.slice(1).map((s, i) => Math.round((Date.parse(s) - Date.parse(starts[i])) / 864e5)).sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  return g === 7 ? `Weekly${day ? ` on ${day}` : ''}` : g === 14 ? `Every 2 weeks${day ? ` on ${day}` : ''}` : g === 1 ? 'Daily' : g >= 28 && g <= 31 ? 'Monthly' : `About every ${g} days`;
}

/** Every meeting series Heartwood knows about, soonest next meeting first. */
export function meetingSeries({ people, myName = '' } = {}) {
  const rows = db.prepare(`SELECT uid, title, start, attendees, 'calendar' AS source FROM calendar_events
    UNION ALL SELECT uid, title, start, attendees, 'invite' AS source FROM invite_events WHERE key NOT IN (SELECT key FROM calendar_events)
    ORDER BY start`).all();
  const rules = Object.fromEntries(db.prepare(`SELECT uid, component FROM invites WHERE recurrence_id = ''`).all()
    .map(r => [r.uid, r.component.match(/^RRULE:(.*)$/m)?.[1] || '']));
  const now = new Date().toISOString();
  const byUid = new Map();
  for (const r of rows) {
    if (!byUid.has(r.uid)) byUid.set(r.uid, { uid: r.uid, source: r.source, title: r.title, starts: [], attendees: r.attendees });
    const s = byUid.get(r.uid);
    s.starts.push(r.start);
    if (r.start >= now && (!s.next || r.start < s.next)) { s.next = r.start; s.title = r.title || s.title; s.attendees = r.attendees; }
    if (r.start < now) s.last = r.start;
  }
  return [...byUid.values()].map(s => {
    const ev = { title: s.title, attendees: JSON.parse(s.attendees || '[]') };
    return {
      uid: s.uid, title: s.title, source: s.source,
      recurring: !!rules[s.uid] || s.starts.length > 1,
      cadence: cadence(rules[s.uid], s.starts),
      next: s.next || null, last: s.last || null,
      upcoming: s.starts.filter(x => x >= now).slice(0, 3),
      people: peopleOverride(s.uid, people) || matchPeople(ev, people, myName)
    };
  }).sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999'));
}
