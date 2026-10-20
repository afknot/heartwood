// Ask your journal: gather the right context for a question, including anything you pointed at
// (a person, a note, a recurring meeting) and anything you attached (files, photos), and keep
// labels so the answer can link back to notes [E#], people [P#] and recurring meetings [R#].
import { contextBlock } from './context.js';
import { db, hydrateEntry, getSettings, listPeople, ftsQuery, safeJson } from './db.js';
import { listFollowups } from './followups.js';
import { listSchedules } from './schedules.js';
import { meetingSeries } from './calendar.js';
import { askPrompt, entryText } from './prompts.js';

const REL = { direct_report: 'direct report', peer: 'peer', manager: 'manager', mentor: 'the writer’s mentor', mentee: 'someone the writer mentors', stakeholder: 'stakeholder', other: 'other' };
const MAX_ENTRIES = 34;
const ATTACH_TEXT_NOW = 40000; // per file, on the turn it's attached
const ATTACH_TEXT_LATER = 8000; // per file, when replaying earlier turns
const MAX_IMAGES = 8;

const entriesFor = (personIds, limit) => personIds.length ? db.prepare(`SELECT DISTINCT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id
  WHERE ep.person_id IN (${personIds.map(() => '?').join(',')}) ORDER BY e.created_at DESC LIMIT ?`).all(...personIds, limit) : [];

/** Attachments by id, in the order given. */
export function getAttachments(ids = []) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM ask_attachments WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = Object.fromEntries(rows.map(r => [r.id, { ...r, images: safeJson(r.images, []) }]));
  return ids.map(id => byId[id]).filter(Boolean);
}

const attachmentBlock = (a, max) => {
  const text = a.text.length > max ? `${a.text.slice(0, max)}\n…[rest of file not shown]` : a.text;
  const pics = a.images.length ? ` (${a.images.length === 1 ? 'a photo or scanned page, shown above' : `${a.images.length} pages or photos, shown above`})` : '';
  return `[Attached file: ${a.name}${pics}]${text ? `\n${text}` : ''}`;
};

/**
 * @param {{ question: string, history: any[], refs: {type:'person'|'entry'|'schedule', id:string}[], attachments: any[] }} o
 * @returns {{ system: string, messages: any[], sources: any[] }}
 */
export function buildAsk({ question, history = [], refs = [], attachments = [] }) {
  const people = listPeople();
  const peopleById = Object.fromEntries(people.map(p => [p.id, p]));
  const schedules = listSchedules(people).filter(s => s.active);
  const pick = (type, id) => refs.some(r => r.type === type && r.id === id);

  // Earlier turns in this chat, replaying the text of anything attached along the way.
  const recent = history.slice(-12);
  const earlierAttach = getAttachments([...new Set(recent.flatMap(m => (m.attachments || []).map(a => a.id)))]);
  const attachById = Object.fromEntries(earlierAttach.map(a => [a.id, a]));
  const msgs = recent.map(m => {
    const files = (m.attachments || []).map(a => attachById[a.id]).filter(Boolean);
    // Labels like [E3] are renumbered every turn, so earlier answers name what they cited instead.
    if (m.role === 'assistant') {
      const map = Object.fromEntries((m.sources || []).map(x => [x.ref, x.title]));
      return { role: 'assistant', content: String(m.content).replace(/\[([EPRM]\d+)\]/g, (all, ref) => (map[ref] ? `“${map[ref]}”` : '')) };
    }
    const content = files.length ? `${m.content}\n\n${files.map(a => attachmentBlock(a, ATTACH_TEXT_LATER)).join('\n\n')}` : m.content;
    return { role: m.role, content };
  });
  // Photos from the last couple of turns stay visible for follow-up questions.
  const recentPics = recent.filter(m => m.role === 'user' && m.attachments?.length).slice(-2)
    .flatMap(m => m.attachments.map(a => attachById[a.id]).filter(Boolean)).flatMap(a => a.images);

  // Everything you pointed at, plus anything mentioned by name in the last two questions.
  const ql = [...recent.filter(m => m.role === 'user').slice(-1).map(m => m.content), question].join(' ').toLowerCase();
  const personIds = new Set(refs.filter(r => r.type === 'person' && peopleById[r.id]).map(r => r.id));
  for (const p of people) {
    const first = p.name.toLowerCase().split(/\s+/)[0];
    if (ql.includes(p.name.toLowerCase()) || (first.length > 2 && new RegExp(`\\b${first.replace(/[^\p{L}]/gu, '')}\\b`, 'u').test(ql))) personIds.add(p.id);
  }
  const pickedSchedules = schedules.filter(s => pick('schedule', s.id));
  for (const s of pickedSchedules) for (const p of s.people) personIds.add(p.id);
  // Meetings from invites and your calendar: the ones you picked, plus anything this month.
  const soon = new Date(Date.now() + 30 * 864e5).toISOString(), ago = new Date(Date.now() - 30 * 864e5).toISOString();
  const series = meetingSeries({ people, myName: getSettings().profile?.name })
    .filter(m => pick('meeting', m.uid) || (m.next && m.next <= soon) || (m.last && m.last >= ago)).slice(0, 40);
  const pickedMeetings = series.filter(m => pick('meeting', m.uid));
  for (const m of pickedMeetings) for (const p of m.people) personIds.add(p.id);

  const picked = new Map();
  const add = (rows, { pinned = false } = {}) => rows.forEach(r => {
    if (!picked.has(r.id) && (pinned || picked.size < MAX_ENTRIES)) picked.set(r.id, { row: r, pinned });
  });
  // 1. Notes you pointed at, in full.
  const entryRefs = refs.filter(r => r.type === 'entry').map(r => r.id);
  if (entryRefs.length) add(db.prepare(`SELECT * FROM entries WHERE id IN (${entryRefs.map(() => '?').join(',')})`).all(...entryRefs), { pinned: true });
  // 2. Recent notes with the people involved (more for people you picked).
  for (const id of personIds) add(entriesFor([id], pick('person', id) ? 15 : 8));
  for (const s of pickedSchedules) add(entriesFor(s.people.map(p => p.id), 10));
  for (const m of pickedMeetings) add(entriesFor(m.people.map(p => p.id), 12));
  // 3. Full-text matches, then recent notes for general questions.
  const fq = ftsQuery(`${question} ${attachments.map(a => a.text.slice(0, 300)).join(' ')}`.slice(0, 600));
  if (fq) { try { add(db.prepare(`SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY bm25(entries_fts) LIMIT 15`).all(fq)); } catch { /* odd query syntax */ } }
  add(db.prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT 8').all());

  const entries = [...picked.values()].map(({ row, pinned }) => ({ entry: hydrateEntry(row), pinned }))
    .sort((a, b) => a.entry.created_at.localeCompare(b.entry.created_at));
  const refsE = entries.map(({ entry, pinned }, i) => ({ ref: `E${i + 1}`, entry, pinned }));
  const refsP = people.map((p, i) => ({ ref: `P${i + 1}`, person: p }));
  const refsR = schedules.map((s, i) => ({ ref: `R${i + 1}`, schedule: s }));
  const refsM = series.map((m, i) => ({ ref: `M${i + 1}`, meeting: m }));
  const pRef = Object.fromEntries(refsP.map(r => [r.person.id, r.ref]));

  const s = getSettings();
  let { system } = askPrompt({ refs: refsE.map(r => r.pinned ? { ...r, full: entryText(r.entry, { maxChars: 14000 }) } : r), profile: s.profile, people });

  system += `\n\nPeople, with reference labels:\n${refsP.map(({ ref, person: p }) => `[${ref}] ${p.name}${p.pronouns ? ` (${p.pronouns})` : ''}${p.role ? `, ${p.role}` : ''}${p.relationship ? ` (${REL[p.relationship] || p.relationship})` : ''}`).join('\n') || '(none)'}`;
  if (refsR.length) {
    system += `\n\nRecurring meetings, with reference labels:\n${refsR.map(({ ref, schedule: r }) =>
      `[${ref}] ${r.display_title} with ${r.people.map(p => `${p.name} [${pRef[p.id]}]`).join(', ') || 'no one yet'}; next: ${r.next.map(o => o.start.slice(0, 16).replace('T', ' ') + ' UTC').join(', ') || 'none scheduled'}`).join('\n')}`;
  }
  if (refsM.length) {
    const when = iso => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : 'none');
    system += `\n\nMeetings from the writer's calendar and invites, with reference labels:\n${refsM.map(({ ref, meeting: m }) =>
      `[${ref}] "${m.title}"${m.cadence ? `, ${m.cadence}` : m.recurring ? ', recurring' : ', one-off'}; with ${m.people.map(p => `${p.name} [${pRef[p.id]}]`).join(', ') || 'no one matched yet'}; next: ${when(m.next)}${m.last ? `; last: ${when(m.last)}` : ''}`).join('\n')}`;
    // Prep you've already written for a meeting you pointed at.
    const prep = db.prepare(`SELECT content_md AS content, created_at FROM reports WHERE kind = 'prep' AND substr(ref, 1, ?) = ? ORDER BY created_at DESC LIMIT 1`);
    for (const { ref, meeting: m } of refsM.filter(r => pick('meeting', r.meeting.uid))) {
      const r = prep.get(m.uid.length + 1, `${m.uid}|`);
      if (r) system += `\n\nLatest prep for [${ref}] (${r.created_at.slice(0, 10)}):\n${String(r.content).slice(0, 5000)}`;
    }
  }
  // Open follow-ups, the ones about people in play first.
  const open = listFollowups({ status: 'open', limit: 300 });
  const ordered = [...open.filter(f => f.person_id && personIds.has(f.person_id)), ...open.filter(f => !(f.person_id && personIds.has(f.person_id)))].slice(0, 70);
  if (ordered.length) {
    system += `\n\nOpen follow-ups the writer is tracking, most important first:\n${ordered.map(f => `- ${f.text}${f.owner ? ` (owner: ${f.owner})` : ''}${f.person_name ? ` [${f.person_name}]` : ''}${f.due ? `, due ${f.due}` : ''}${f.priority === 'high' ? ' · high priority' : ''}`).join('\n')}`;
  }
  const focus = [
    ...refs.filter(r => r.type === 'person' && pRef[r.id]).map(r => `${peopleById[r.id].name} [${pRef[r.id]}]`),
    ...refsE.filter(r => r.pinned).map(r => `the note "${r.entry.title || 'Untitled'}" [${r.ref}]`),
    ...refsR.filter(r => pick('schedule', r.schedule.id)).map(r => `the recurring meeting "${r.schedule.display_title}" [${r.ref}]`),
    ...refsM.filter(r => pick('meeting', r.meeting.uid)).map(r => `the meeting "${r.meeting.title}" [${r.ref}]`)
  ];
  if (focus.length) system += `\n\nThe writer pointed you at: ${focus.join('; ')}. Center your answer on these.`;
  // Updates and clarifications the writer added to these people, notes and meetings (not journal entries).
  const ctx = contextBlock([
    ...[...personIds].filter(id => peopleById[id]).slice(0, 6).map(id => ({ kind: 'person', id, label: `${peopleById[id].name} [${pRef[id]}]` })),
    ...refsE.filter(r => r.pinned).map(r => ({ kind: 'entry', id: r.entry.id, label: `the note "${r.entry.title || 'Untitled'}" [${r.ref}]` })),
    ...pickedMeetings.map(m => ({ kind: 'meeting', id: m.uid, label: `the meeting "${m.title}"` }))
  ]);
  if (ctx) system += `\n\n${ctx}`;
  system += `\n\nWhen you refer to a note, person or recurring meeting, cite its label in square brackets, e.g. [E3], [P2], [M1], so the writer can tap through. Cite only labels listed above. If the writer attached files or photos, read them closely and say what they show before drawing on the journal. Today is ${new Date().toISOString().slice(0, 10)}.`;

  // This turn: the question, with attached files' text and any photos.
  const images = [...recentPics, ...attachments.flatMap(a => a.images)].slice(-MAX_IMAGES);
  const content = attachments.length ? `${question}\n\n${attachments.map(a => attachmentBlock(a, ATTACH_TEXT_NOW)).join('\n\n')}` : question;
  const messages = [...msgs, { role: 'user', content, ...(images.length ? { images } : {}) }];

  const sources = [
    ...refsE.map(r => ({ ref: r.ref, type: 'entry', id: r.entry.id, title: r.entry.title || 'Untitled', created_at: r.entry.created_at })),
    ...refsP.map(r => ({ ref: r.ref, type: 'person', id: r.person.id, title: r.person.name })),
    ...refsR.map(r => ({ ref: r.ref, type: 'schedule', id: r.schedule.id, title: r.schedule.display_title })),
    ...refsM.map(r => ({ ref: r.ref, type: 'meeting', id: r.meeting.uid, title: r.meeting.title }))
  ];
  return { system, messages, sources };
}

/** Keep only the sources an answer actually cites (and the entries, for older clients). */
export function citedSources(answer, sources) {
  const used = new Set(String(answer).match(/\b[EPRM]\d+\b/g) || []);
  return sources.filter(s => used.has(s.ref));
}
