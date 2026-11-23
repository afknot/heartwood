// "Who was in this?" after a recording or files are processed: the people Heartwood found, for you to confirm.
// Names already in People are found by plain text matching, so this works with reflection off and on
// notes kept out of AI. New names come only from the AI reflection, when there is one.
import { db, getEntryRow, hydrateEntry, listPeople, getSettings, setEntryPeople, updateEntry, now } from './db.js';

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\s'-]/gu, '').trim();
const word = n => new RegExp(`(?<![\\p{L}])${escRe(n)}(?![\\p{L}])`, 'u');

/**
 * People whose name appears in the text: their full name, or a first name only they have.
 * Case-sensitive, so "will" in a sentence isn't Will.
 */
export function namesInText(text, people = []) {
  const t = String(text || '');
  const found = new Set();
  for (const p of people) {
    const full = String(p.name || '').trim();
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    const firstOnly = first.length > 2 && first !== full && people.filter(o => String(o.name || '').trim().split(/\s+/)[0] === first).length === 1;
    if (word(full).test(t) || (firstOnly && word(first).test(t))) found.add(p.id);
  }
  return found;
}

/** Match a name the AI gave back to someone in People (exact, or a first name only one person has). */
function matchName(name, people) {
  const n = norm(name);
  const exact = people.find(p => norm(p.name) === n);
  if (exact) return exact;
  const byFirst = people.filter(p => norm(p.name).split(/\s+/)[0] === n.split(/\s+/)[0]);
  return n.split(/\s+/).length === 1 && byFirst.length === 1 ? byFirst[0] : null;
}

const NOT_PEOPLE = ['me', 'i', 'team', 'the team', 'everyone', 'we'];

export function peopleReview(id) {
  const row = getEntryRow(id);
  if (!row) return null;
  const e = hydrateEntry(row);
  const review = e.people_review || {};
  const people = listPeople();
  const me = norm(getSettings().profile?.name);
  const isMe = n => me && (norm(n) === me || norm(n) === me.split(/\s+/)[0]);
  const text = [e.title, String(e.body_md || '').replace(/\[@([^\]]+)\]\(\/people\/[0-9a-f-]{36}\)/g, '$1'), e.transcript].join('\n');
  const linked = Object.fromEntries(e.people.map(p => [p.id, p.link]));
  const local = namesInText(text, people);
  const fromAi = new Set();
  const fresh = [];
  for (const n of (e.analysis?.people || []).map(String)) {
    const m = matchName(n, people);
    if (m) fromAi.add(m.id); else fresh.push(n.trim());
  }
  const ids = [...new Set([...Object.keys(linked), ...local, ...fromAi])];
  const rows = ids.map(pid => people.find(p => p.id === pid)).filter(p => p && !isMe(p.name)).map(p => ({
    id: p.id, name: p.name, role: p.role || '', relationship: p.relationship || '',
    link: linked[p.id] || null, found: local.has(p.id) || fromAi.has(p.id)
  }));
  const skipped = new Set((review.skipped || []).map(norm));
  // A first name several people share: ask which one, rather than offering to add a duplicate.
  // From the AI's names, and from the text itself (so it works without AI). Settled if one of them is already listed.
  const listedIds = new Set(rows.map(r => r.id));
  const sharing = first => people.filter(p => norm(p.name).split(/\s+/)[0] === norm(first));
  const firstNames = [...new Set(people.map(p => String(p.name || '').trim().split(/\s+/)[0]).filter(f => f.length > 2))];
  const candidates = [...fresh.filter(n => n.trim().split(/\s+/).length === 1), ...firstNames.filter(f => sharing(f).length > 1 && word(f).test(text))];
  const ambiguous = [];
  for (const n of candidates) {
    const opts = sharing(n).filter(p => !isMe(p.name));
    if (opts.length < 2 || opts.some(p => listedIds.has(p.id)) || skipped.has(norm(n)) || ambiguous.some(a => norm(a.name) === norm(n))) continue;
    ambiguous.push({ name: n.trim(), options: opts.map(p => ({ id: p.id, name: p.name, role: p.role || '', relationship: p.relationship || '' })) });
  }
  const isShared = n => n.trim().split(/\s+/).length === 1 && sharing(n).length > 1;
  const newNames = [...new Set(fresh)].filter(n => {
    const x = norm(n);
    return x && !NOT_PEOPLE.includes(x) && !isMe(n) && !skipped.has(x) && !matchName(n, people) && !isShared(n);
  }).slice(0, 10);
  // Ask once a recording or files have been read, when something was found you haven't confirmed.
  const read = !['transcribing', 'processing', 'analyzing'].includes(e.status) && !!(String(e.transcript || '').trim() || String(e.source_text || '').trim());
  const unconfirmed = rows.some(r => r.found && r.link !== 'with') || newNames.length > 0 || ambiguous.length > 0;
  return { show: !review.done && read && unconfirmed, done: !!review.done, people: rows, ambiguous: ambiguous.slice(0, 6), new_names: newNames, skipped: review.skipped || [] };
}

/** Save your choices: who was in it, who was only mentioned, and names to stop suggesting. Anyone else listed is unlinked. */
export function savePeopleReview(id, { with: inIt = [], mentioned = [], skip = [] } = {}) {
  const r = peopleReview(id);
  if (!r) return null;
  const valid = new Set(listPeople().map(p => p.id));
  const keep = arr => [...new Set((Array.isArray(arr) ? arr : []).map(String).filter(x => valid.has(x)))];
  const w = keep(inIt), m = keep(mentioned).filter(x => !w.includes(x));
  // People linked to the note but not shown in the card (you, say) stay as they were.
  const listed = new Set(r.people.map(p => p.id));
  const others = db.prepare('SELECT person_id, role FROM entry_people WHERE entry_id = ?').all(id).filter(x => !listed.has(x.person_id) && !w.includes(x.person_id) && !m.includes(x.person_id));
  setEntryPeople(id, [...w, ...m, ...others.map(x => x.person_id)], { mentioned: [...m, ...others.filter(x => x.role === 'mentioned').map(x => x.person_id)] });
  const names = (Array.isArray(skip) ? skip : []).map(s => String(s).trim().slice(0, 80)).filter(Boolean);
  updateEntry(id, { people_review: { done: true, at: now(), skipped: [...new Set([...r.skipped, ...names])].slice(-50) } });
  return peopleReview(id);
}
