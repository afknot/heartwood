// What's coming up (calendar link + meeting invites + recurring schedules, merged), and prep for one
// conversation. Shared by the Today screen and the morning notification.
import { db, newId, now, hydrateEntry, getSettings, listPeople } from './db.js';
import { upcomingEvents } from './calendar.js';
import { occurrences, findOccurrence, parseKey } from './schedules.js';
import { listFollowups } from './followups.js';
import { complete } from './llm.js';
import { prepPrompt } from './prompts.js';
import { contextBlock } from './context.js';
import { pendingWins, recentKudos } from './kudos.js';

/** Upcoming conversations, soonest first, each with its latest prep (if any). */
export function agenda({ days = 7, from = null } = {}) {
  const s = getSettings();
  const people = listPeople();
  const calEvents = upcomingEvents({ people, myName: s.profile?.name, days, from });
  const schedEvents = occurrences({ people, days, ...(from ? { from } : {}) });
  // If a calendar event already covers a scheduled conversation (same person, within 3 hours), show it once.
  const dupe = o => calEvents.some(e => e.people.some(p => o.people.some(q => q.id === p.id)) && Math.abs(Date.parse(e.start) - Date.parse(o.start)) < 3 * 3600e3);
  const events = [...calEvents, ...schedEvents.filter(o => !dupe(o))].sort((a, b) => a.start.localeCompare(b.start));
  const prepFor = db.prepare(`SELECT id, created_at FROM reports WHERE kind = 'prep' AND ref = ? ORDER BY created_at DESC LIMIT 1`);
  for (const ev of events) {
    const r = prepFor.get(ev.key);
    ev.prep = r ? { id: r.id, created_at: r.created_at } : null;
  }
  return events;
}

// The series an event belongs to: "sched:<id>" for a Heartwood schedule, the calendar UID otherwise.
const seriesOf = key => { const k = String(key || ''); return k.startsWith('sched:') ? k.split(':').slice(0, 2).join(':') : k.split('|')[0]; };

/**
 * Recent prep for the same person and meeting series when nothing has happened since: no new notes,
 * follow-ups or context. Copying it costs nothing; writing it again would say the same thing.
 */
function unchangedPrep(person, eventKey) {
  const last = db.prepare(`SELECT * FROM reports WHERE kind = 'prep' AND person_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .get(person.id, new Date(Date.now() - 14 * 864e5).toISOString());
  if (!last || (eventKey && seriesOf(last.ref) !== seriesOf(eventKey))) return null;
  const since = last.created_at;
  const changed = db.prepare(`SELECT
      EXISTS (SELECT 1 FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = @p AND (e.created_at > @t OR e.updated_at > @t)) OR
      EXISTS (SELECT 1 FROM followups WHERE person_id = @p AND (created_at > @t OR done_at > @t)) OR
      EXISTS (SELECT 1 FROM context_notes WHERE subject_kind = 'person' AND subject_id = @p AND at > @t) OR
      EXISTS (SELECT 1 FROM career_drafts WHERE kind = 'recognition' AND title LIKE @n AND updated_at > @t) AS changed`).get({ p: person.id, t: since, n: `%${person.name}%` }).changed;
  if (changed) return null;
  return last;
}

/**
 * Write prep for a conversation with one person (optionally a specific event). Returns the report row.
 * reuse: when nothing is new since the last prep for this series, copy it instead of asking the AI.
 */
export async function makePrep({ personId, eventKey = null, reuse = false }) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) throw Object.assign(new Error('Pick who the conversation is with.'), { status: 400 });
  const same = reuse ? unchangedPrep(person, eventKey) : null;
  if (same) {
    const id = newId();
    db.prepare(`INSERT INTO reports(id, kind, person_id, title, content_md, entry_count, ref, created_at) VALUES (?, 'prep', ?, ?, ?, ?, ?, ?)`)
      .run(id, person.id, same.title, same.content_md, same.entry_count, eventKey || same.ref, same.created_at);
    return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  }
  const ev = !eventKey ? null : parseKey(eventKey) ? findOccurrence(eventKey, listPeople())
    : db.prepare('SELECT * FROM calendar_events WHERE key = ?').get(eventKey) || db.prepare('SELECT * FROM invite_events WHERE key = ?').get(eventKey);
  const rows = db.prepare(`SELECT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at DESC LIMIT 10`).all(person.id);
  const entries = rows.map(r => hydrateEntry(r)).reverse();
  const followups = listFollowups({ status: 'open', personId: person.id, limit: 30 });
  const s = getSettings();
  const k = recentKudos(person);
  const kudos = { wins: pendingWins(person), say: k && !(k.sent || []).some(x => x.to === 'say') ? k.say || '' : '' };
  const { system, messages } = prepPrompt({ person, event: ev, entries, followups, profile: s.profile, people: listPeople(), kudos });
  const ctx = contextBlock([{ kind: 'person', id: person.id, label: person.name }, ...(ev?.uid ? [{ kind: 'meeting', id: ev.uid, label: `this meeting` }] : [])]);
  if (ctx) messages[0].content += `\n\n${ctx}`;
  const content = await complete({ system, messages, maxTokens: 2500, task: 'prep' });
  const id = newId();
  const title = ev ? `Prep: ${ev.title}` : `Prep: ${person.name}`;
  db.prepare(`INSERT INTO reports(id, kind, person_id, title, content_md, entry_count, ref, created_at) VALUES (?, 'prep', ?, ?, ?, ?, ?, ?)`)
    .run(id, person.id, title, content, entries.length, ev?.key || eventKey || null, now());
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}
