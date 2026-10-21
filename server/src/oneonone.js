// 1:1 agenda builder. Pick a kind of conversation; Heartwood lays out a structure, brings in open
// follow-ups with that person, adds questions that fit your leadership styles, and (with an AI key)
// suggests a few specific topics from your journal. You edit it, share the parts meant for them,
// and start your notes from it.
//
// The structures draw on Andy Grove (the 1:1 is their meeting), Lara Hogan (first 1:1s), Kim Scott
// (asking for feedback first), Michael Bungay Stanier (coaching questions) and interest-based
// mediation, all in Heartwood's own words.
import crypto from 'node:crypto';
import { db, newId, now, hydrateEntry, getSettings } from './db.js';
import { listFollowups } from './followups.js';
import { complete } from './llm.js';
import { COACH_STANCE, profileBlock, entryDigest } from './prompts.js';
import { pendingWins, recentKudos } from './kudos.js';
import { chosenStyles } from './leadership.js';
import { config } from './config.js';

const q = (text, extra = {}) => ({ text, ...extra });

export const TEMPLATES = {
  regular: {
    label: 'Regular 1:1', minutes: 30,
    about: 'Their meeting first, then progress, growth and feedback both ways.',
    sections: [
      { key: 'theirs', title: 'Their topics first', hint: 'It’s their meeting. Start with what they want to cover.', items: [q('What do you want to make sure we cover today?')] },
      { key: 'checkin', title: 'How they’re doing', items: [q('How are you doing, really? Energy, workload, anything you want me to know.')] },
      { key: 'progress', title: 'Progress and blockers', items: [q('What’s going well?'), q('What’s in your way that I could help with?')] },
      { key: 'loops', title: 'Open loops', hint: 'Follow-ups between you that are still open.', items: [] },
      { key: 'growth', title: 'Growth', items: [q('What are you learning, or wanting to learn next?')] },
      { key: 'feedback', title: 'Feedback, both ways', items: [q('Something I appreciated recently: …'), q('What could I do, or stop doing, to make your work easier?')] },
      { key: 'close', title: 'Wrap-up', items: [q('What are we each taking away? Owners and dates.')] }
    ]
  },
  checkin: {
    label: 'Quick check-in', minutes: 15,
    about: 'Short and human: how they are, one thing you can help with.',
    sections: [
      { key: 'checkin', title: 'How they’re doing', items: [q('How’s your week going?')] },
      { key: 'progress', title: 'One thing', items: [q('What’s the one thing I could help with this week?')] },
      { key: 'loops', title: 'Open loops', items: [] },
      { key: 'close', title: 'Anything else', items: [q('Anything I should know about?')] }
    ]
  },
  first: {
    label: 'First 1:1', minutes: 45,
    about: 'Getting to know how they work best. Inspired by Lara Hogan’s first 1:1 questions.',
    sections: [
      { key: 'know', title: 'Getting to know each other', items: [
        q('What has made a manager great to work with in the past, or hard?'),
        q('How do you like feedback: in the moment or saved for 1:1s, in writing or in person?'),
        q('How do you like to be recognized: in front of others or one-on-one?'),
        q('How will I know when something’s bothering you, and what helps?')] },
      { key: 'goals', title: 'Goals and support', items: [
        q('What do you want to achieve in the next three months? This year?'),
        q('What do you need from me? From the team?'),
        q('What would make these 1:1s most useful for you?')] },
      { key: 'close', title: 'How we’ll work together', items: [q('Agree on how often we meet, for how long, and where notes live.')] }
    ]
  },
  career: {
    label: 'Career conversation', minutes: 45,
    about: 'Where they want to go and how you’ll help them get there.',
    sections: [
      { key: 'story', title: 'What energizes them', items: [q('What parts of your work give you the most energy? The least?'), q('What are you proudest of from the last year?')] },
      { key: 'future', title: 'Where they want to go', items: [q('Where would you like to be in two or three years? What would make that a great outcome?')] },
      { key: 'growth', title: 'Strengths and growth', items: [q('Which strengths do you want to use more?'), q('What skills or experiences would get you there?')] },
      { key: 'close', title: 'Next steps', items: [q('One stretch opportunity for next quarter'), q('How I’ll support it, and by when')] }
    ]
  },
  feedback: {
    label: 'Feedback conversation', minutes: 30,
    about: 'Clear and caring: what you saw, how they see it, what’s next.',
    sections: [
      { key: 'open', title: 'Open well', items: [q('Check it’s a good time, and say why you want to talk.', { private: true })] },
      { key: 'share', title: 'What you saw', hint: 'The situation, what happened, the impact. Behavior, not labels.', items: [q('Situation: …'), q('What I noticed: …'), q('Impact: …')] },
      { key: 'listen', title: 'Their view', items: [q('How do you see it? What was going on for you?')] },
      { key: 'ahead', title: 'What’s next', items: [q('What will you try? What do you need from me?'), q('When we’ll check back in')] },
      { key: 'theirs', title: 'Feedback for you', items: [q('Is there anything I could do differently?')] }
    ]
  },
  tension: {
    label: 'Working through a tension', minutes: 45,
    about: 'Mediate rather than reprimand: understand each side, find the needs underneath, agree what’s next.',
    note: 'If it involves harassment, discrimination, threats or safety, take it to HR rather than mediating it yourself.',
    sections: [
      { key: 'prep', title: 'Before you meet', items: [
        q('Talk with each person separately first.', { private: true }),
        q('Your aim: a working relationship that works again, not a verdict.', { private: true })] },
      { key: 'views', title: 'Each perspective', hint: 'One person at a time, without interruptions.', items: [q('What happened, from your point of view?'), q('What’s important to you about it?')] },
      { key: 'needs', title: 'What’s underneath', items: [q('What do you need to be able to work well together?')] },
      { key: 'options', title: 'Options', items: [q('What could we try that works for both of you?')] },
      { key: 'close', title: 'Agreement', items: [q('What we’ve agreed, and who does what'), q('When we’ll check how it’s going')] }
    ]
  }
};

// A question or two from each leadership style you've chosen, placed where it fits.
const STYLE_ITEMS = {
  servant: { section: 'progress', text: 'What’s slowing you down that I could clear?' },
  space: { section: 'progress', text: 'What are you deciding this week, and is there context you need from me?' },
  coach: { section: 'progress', text: 'What’s the real challenge here for you? And what else?' },
  empathetic: { section: 'checkin', text: 'Is there anything you’re carrying that’s making work harder?' },
  candid: { section: 'feedback', text: 'Specific feedback I owe you: …', private: true },
  mediator: { section: 'checkin', text: 'Any friction with anyone that’s getting in the way?' },
  visionary: { section: 'growth', text: 'How does your work connect to where we’re headed?' }
};

const itemId = () => crypto.randomBytes(6).toString('hex');
const clean = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The kind of conversation to suggest: a first 1:1 when there's no history with them. */
export function suggestTemplate(personId) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM entry_people WHERE person_id = ?').get(personId)?.n || 0;
  return n === 0 ? 'first' : 'regular';
}

function skeleton(template, person, styles) {
  const t = TEMPLATES[template];
  const items = [];
  const keys = new Set(t.sections.map(s => s.key));
  for (const sec of t.sections) for (const it of sec.items) items.push({ id: itemId(), section: sec.key, text: it.text, from: 'template', private: !!it.private, done: false });
  for (const s of styles) {
    const extra = STYLE_ITEMS[s];
    if (extra && keys.has(extra.section)) items.push({ id: itemId(), section: extra.section, text: extra.text, from: 'style', style: s, private: !!extra.private, done: false });
  }
  // Kudos: a win you haven't recognized yet (or the line you drafted), where feedback goes.
  const kSection = ['feedback', 'progress', 'checkin'].find(k => keys.has(k));
  if (kSection) {
    const k = recentKudos(person);
    const said = (k?.sent || []).some(x => x.to === 'say');
    const win = pendingWins(person).at(-1);
    if (k?.say && !said) items.push({ id: itemId(), section: kSection, text: `Kudos: ${clean(k.say, 240)}`, from: 'kudos', kudos_id: k.id, private: true, done: false });
    else if (win) items.push({ id: itemId(), section: kSection, text: `Kudos: thank ${person.name.split(' ')[0]} for ${clean(win.text, 200).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())}`, from: 'kudos', private: true, done: false });
  }
  if (keys.has('loops')) {
    for (const f of listFollowups({ status: 'open', personId: person.id, limit: 8 })) {
      items.push({ id: itemId(), section: 'loops', text: `${f.mine ? 'Me' : person.name.split(' ')[0]}: ${clean(f.text, 200)}`, from: 'followup', followup_id: f.id, private: false, done: false });
    }
  }
  return items;
}

const AGENDA_SYSTEM = template => `${COACH_STANCE}

Your task: suggest a few specific additions to a ${TEMPLATES[template].label.toLowerCase()} agenda, based on the writer's journal about this person. The agenda already has general questions; add what only this journal could tell you: topics worth raising now, a win to recognize, a concern to check on, a tailored question. Fit them to the writer's leadership styles if given.

Rules:
- 2 to 6 items. Each "text" under 20 words, written as a topic or a question the writer could say.
- "section" must be one of: ${TEMPLATES[template].sections.map(s => s.key).join(', ')}.
- "why": under 15 words, the journal reason (for the writer only).
- Nothing already covered by the open follow-ups listed.
- Never suggest raising sensitive personal matters the person hasn't brought up themselves.

Return JSON only: {"items":[{"section":"...","text":"...","why":"..."}]}`;

async function suggestions(template, person, profile, items) {
  const provider = getSettings().ai_provider;
  if (!config.keys[provider]) return { items: [], note: 'Add an AI key in Settings to get suggestions from your notes.' };
  const rows = db.prepare(`SELECT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at DESC LIMIT 6`).all(person.id);
  if (!rows.length) return { items: [], note: '' };
  const entries = rows.map(r => hydrateEntry(r)).reverse();
  const user = [
    `Person: ${person.name}${person.pronouns ? ` (${person.pronouns})` : ''}${person.role ? `, ${person.role}` : ''}`,
    `Writer's notes about them: ${person.notes || '(none)'}`,
    '',
    'Already on the agenda:',
    ...items.map(i => `- [${i.section}] ${i.text}`),
    '',
    'Recent entries with them, oldest first:',
    entries.map(e => entryDigest(e, 1500)).join('\n\n---\n\n')
  ].join('\n');
  try {
    const out = await complete({ system: `${AGENDA_SYSTEM(template)}\n\n${profileBlock(profile)}`, messages: [{ role: 'user', content: user }], json: true, maxTokens: 1500, task: 'agenda' });
    const keys = new Set(TEMPLATES[template].sections.map(s => s.key));
    return {
      items: (Array.isArray(out?.items) ? out.items : []).filter(i => keys.has(i.section) && clean(i.text)).slice(0, 6)
        .map(i => ({ id: itemId(), section: i.section, text: clean(i.text, 200), why: clean(i.why, 140), from: 'journal', private: true, done: false })),
      note: ''
    };
  } catch (err) {
    return { items: [], note: `Couldn’t get suggestions from your notes this time (${clean(err.message, 120)}). The structure is ready to use.` };
  }
}

const shape = row => row && ({
  id: row.id, person_id: row.person_id, event_key: row.event_key, template: row.template, title: row.title,
  items: (() => { try { return JSON.parse(row.items); } catch { return []; } })(),
  entry_id: row.entry_id, created_at: row.created_at, updated_at: row.updated_at
});

export const getAgenda = id => shape(db.prepare('SELECT * FROM agendas WHERE id = ?').get(id));

/** The agenda for a meeting, or the latest one for a person that isn't tied to a meeting. */
export function findAgenda({ personId, eventKey }) {
  if (eventKey) {
    const r = db.prepare('SELECT * FROM agendas WHERE event_key = ? ORDER BY updated_at DESC LIMIT 1').get(eventKey);
    if (r) return shape(r);
  }
  if (!personId) return null;
  // A draft for this person not yet used for notes, from the last two weeks.
  return shape(db.prepare(`SELECT * FROM agendas WHERE person_id = ? AND entry_id IS NULL AND (event_key IS NULL OR ? IS NULL) AND created_at >= ? ORDER BY updated_at DESC LIMIT 1`)
    .get(personId, eventKey || null, new Date(Date.now() - 14 * 864e5).toISOString()));
}

/** Build a new agenda. */
export async function buildAgenda({ personId, eventKey = null, template, title = '', suggest = true }) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) throw Object.assign(new Error('Pick who the conversation is with.'), { status: 400 });
  const kind = TEMPLATES[template] ? template : suggestTemplate(person.id);
  const profile = getSettings().profile || {};
  const items = skeleton(kind, person, chosenStyles(profile));
  const s = suggest ? await suggestions(kind, person, profile, items) : { items: [], note: '' };
  const all = [...items, ...s.items];
  const id = newId(), t = now();
  db.prepare('INSERT INTO agendas(id, person_id, event_key, template, title, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, person.id, eventKey || null, kind, clean(title, 200) || `${TEMPLATES[kind].label} with ${person.name.split(' ')[0]}`, JSON.stringify(all), t, t);
  return { ...getAgenda(id), note: s.note };
}

/** Save your edits. Items are kept to the agenda's own sections. */
export function updateAgenda(id, { items, title }) {
  const a = getAgenda(id);
  if (!a) return null;
  const keys = new Set(TEMPLATES[a.template].sections.map(s => s.key));
  const next = Array.isArray(items) ? items.filter(i => i && keys.has(i.section) && clean(i.text)).slice(0, 80).map(i => ({
    id: /^[a-f0-9]{6,24}$/.test(i.id || '') ? i.id : itemId(), section: i.section, text: clean(i.text, 300),
    from: ['template', 'style', 'followup', 'journal', 'you'].includes(i.from) ? i.from : 'you',
    ...(i.followup_id ? { followup_id: String(i.followup_id) } : {}), ...(i.why ? { why: clean(i.why, 140) } : {}), ...(i.style ? { style: clean(i.style, 20) } : {}),
    private: !!i.private, done: !!i.done
  })) : a.items;
  db.prepare('UPDATE agendas SET items = ?, title = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), typeof title === 'string' && clean(title) ? clean(title, 200) : a.title, now(), id);
  return getAgenda(id);
}

export function deleteAgenda(id) { db.prepare('DELETE FROM agendas WHERE id = ?').run(id); }

/** The agenda as text to send them: only what isn't marked private. */
export function shareText(a) {
  const t = TEMPLATES[a.template];
  const lines = [a.title, ''];
  for (const sec of t.sections) {
    const items = a.items.filter(i => i.section === sec.key && !i.private);
    if (!items.length) continue;
    lines.push(sec.title);
    for (const i of items) lines.push(`• ${i.text}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** Start your notes for the conversation from the agenda (or reopen them). */
export function startNotes(id) {
  const a = getAgenda(id);
  if (!a) return null;
  if (a.entry_id && db.prepare('SELECT 1 FROM entries WHERE id = ?').get(a.entry_id)) return a.entry_id;
  const t = TEMPLATES[a.template];
  const body = t.sections.map(sec => {
    const items = a.items.filter(i => i.section === sec.key);
    return items.length ? `## ${sec.title}\n\n${items.map(i => `- [ ] ${i.text}`).join('\n')}\n\n` : '';
  }).join('').trim();
  const entryId = newId(), ts = now();
  db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, created_at, updated_at) VALUES (?, ?, 'one_on_one', ?, '["1:1"]', ?, ?)`).run(entryId, a.title, body, ts, ts);
  if (a.person_id) db.prepare('INSERT OR IGNORE INTO entry_people(entry_id, person_id) VALUES (?, ?)').run(entryId, a.person_id);
  db.prepare('UPDATE agendas SET entry_id = ?, updated_at = ? WHERE id = ?').run(entryId, ts, id);
  return entryId;
}

export const templateList = () => Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, minutes: t.minutes, about: t.about, note: t.note || '', sections: t.sections.map(s => ({ key: s.key, title: s.title, hint: s.hint || '' })) }));

