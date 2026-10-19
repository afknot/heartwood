// What's coming up (calendar link + meeting invites + recurring schedules, merged), and prep for one
// conversation. Shared by the Today screen and the morning notification.
import { db, newId, now, hydrateEntry, getSettings, listPeople } from './db.js';
import { upcomingEvents } from './calendar.js';
import { occurrences, findOccurrence, parseKey } from './schedules.js';
import { listFollowups } from './followups.js';
import { complete } from './llm.js';
import { prepPrompt } from './prompts.js';
import { contextBlock } from './context.js';

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

/** Write prep for a conversation with one person (optionally a specific event). Returns the report row. */
export async function makePrep({ personId, eventKey = null }) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) throw Object.assign(new Error('Pick who the conversation is with.'), { status: 400 });
  const ev = !eventKey ? null : parseKey(eventKey) ? findOccurrence(eventKey, listPeople())
    : db.prepare('SELECT * FROM calendar_events WHERE key = ?').get(eventKey) || db.prepare('SELECT * FROM invite_events WHERE key = ?').get(eventKey);
  const rows = db.prepare(`SELECT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at DESC LIMIT 10`).all(person.id);
  const entries = rows.map(r => hydrateEntry(r)).reverse();
  const followups = listFollowups({ status: 'open', personId: person.id, limit: 30 });
  const s = getSettings();
  const { system, messages } = prepPrompt({ person, event: ev, entries, followups, profile: s.profile, people: listPeople() });
  const ctx = contextBlock([{ kind: 'person', id: person.id, label: person.name }, ...(ev?.uid ? [{ kind: 'meeting', id: ev.uid, label: `this meeting` }] : [])]);
  if (ctx) messages[0].content += `\n\n${ctx}`;
  const content = await complete({ system, messages, maxTokens: 2500 });
  const id = newId();
  const title = ev ? `Prep: ${ev.title}` : `Prep: ${person.name}`;
  db.prepare(`INSERT INTO reports(id, kind, person_id, title, content_md, entry_count, ref, created_at) VALUES (?, 'prep', ?, ?, ?, ?, ?, ?)`)
    .run(id, person.id, title, content, entries.length, ev?.key || eventKey || null, now());
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}
