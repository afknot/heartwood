// Live coach: while you record a conversation, the phone sends a short piece of audio every half
// minute. Heartwood transcribes it with your transcription engine, keeps a rolling transcript in
// memory, and on request suggests a question to ask, something to say, or a commitment to note.
// Nothing here is saved: the session lives in memory and is dropped when you stop (or after a few
// hours). The full recording is transcribed and reflected on afterwards as usual.
import fs from 'node:fs';
import { db, newId, getSettings, listPeople } from './db.js';
import { complete, CACHE_BREAK } from './llm.js';
import { transcribeFile } from './transcribe.js';
import { COACH_STANCE, profileBlock, peopleBlock, kindLabel } from './prompts.js';
import { listFollowups } from './followups.js';
import { pendingWins } from './kudos.js';
import { contextBlock } from './context.js';

const TTL = 4 * 3600e3;
const MAX_SESSIONS = 4;
const sessions = new Map();

export class LiveError extends Error {}

function sweep() {
  const cut = Date.now() - TTL;
  for (const [id, s] of sessions) if (s.touched < cut) sessions.delete(id);
}

const get = id => {
  sweep();
  const s = sessions.get(String(id));
  if (!s) throw Object.assign(new LiveError('This live session ended. Suggestions will start again with your next recording.'), { status: 404 });
  s.touched = Date.now();
  return s;
};

export function startLive({ kind = 'conversation', people = [], title = '' } = {}) {
  sweep();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
    sessions.delete(oldest[0]);
  }
  const known = new Set(listPeople().map(p => p.id));
  const id = newId();
  sessions.set(id, {
    id, kind: String(kind).slice(0, 40), title: String(title).slice(0, 160),
    people: (Array.isArray(people) ? people : []).map(String).filter(p => known.has(p)).slice(0, 12),
    parts: [], // { at: seconds into the recording, text }
    suggested: [], // earlier suggestions, so they don't repeat
    chain: Promise.resolve(), pending: 0, touched: Date.now(), lastSuggestChars: 0
  });
  return { id };
}

export const endLive = id => { sessions.delete(String(id)); return { ok: true }; };

const chars = s => s.parts.reduce((n, p) => n + p.text.length, 0);

/** Transcribe one piece of audio and add it to the session. Pieces are handled in order. */
export function addAudio(id, file, at = 0) {
  const s = get(id);
  // If transcription falls behind (slow local engine), skip pieces rather than queue up forever.
  if (s.pending >= 2) { fs.rm(file, { force: true }, () => {}); return Promise.resolve({ skipped: true, chars: chars(s) }); }
  s.pending++;
  const work = s.chain.then(async () => {
    try {
      const names = listPeople().filter(p => s.people.includes(p.id)).map(p => p.name);
      const hint = [...names, ...listPeople().map(p => p.name)].join(', ').slice(0, 400);
      const text = (await transcribeFile(file, { hint, kind: s.kind, workId: newId() })).trim();
      if (text) s.parts.push({ at: Math.max(0, Math.round(Number(at) || 0)), text });
      return { chars: chars(s) };
    } finally {
      s.pending--;
      fs.rm(file, { force: true }, () => {});
    }
  });
  s.chain = work.catch(() => {});
  return work;
}

const clock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function liveSystem(profile, people) {
  return `${COACH_STANCE}

${profileBlock(profile)}

${peopleBlock(people)}${CACHE_BREAK}Your task right now: the writer is IN a conversation, recording it, and glancing at their phone. From the live transcript, suggest what they could do in the next minute or two.

The transcript comes from speech recognition: no speaker labels, some words wrong. Work out who is speaking from context, and don't over-read single words.

Give 1 to 3 suggestions, each one of:
- "ask": a short, open question that follows what was just said. Curious, not leading.
- "say": a response the writer could give: acknowledge a feeling, reflect back what they heard, recognize something, or be candid where it's needed.
- "note": a commitment, decision or follow-up that was just made, so they capture it (owner and date if said).

Rules:
- React to the last minute or two first; use earlier parts and the background only to make it specific.
- Each "text" under 18 words, in words the writer could actually say. Each "why" under 10 words.
- If the moment is emotional or tense, favor listening and acknowledging over solving.
- Don't repeat earlier suggestions. Don't suggest raising sensitive personal matters the other person hasn't brought up.
- If the conversation hasn't really started or nothing useful stands out, return an empty list.

Return JSON only: {"items":[{"type":"ask|say|note","text":"...","why":"..."}]}`;
}

/** Suggestions for this moment in the conversation. */
export async function suggestLive(id) {
  const s = get(id);
  await s.chain; // include the piece that's being transcribed now
  if (!s.parts.length) return { items: [], waiting: true };
  const settings = getSettings();
  const people = listPeople();
  const inIt = people.filter(p => s.people.includes(p.id));

  const background = [];
  for (const p of inIt.slice(0, 4)) {
    const lines = [`${p.name}${p.pronouns ? ` (${p.pronouns})` : ''}${p.role ? `, ${p.role}` : ''}`];
    const open = listFollowups({ status: 'open', personId: p.id, limit: 6 });
    if (open.length) lines.push(`Open follow-ups: ${open.map(f => `${f.text}${f.owner ? ` (${f.owner})` : ''}`).join('; ')}`);
    const wins = pendingWins(p);
    if (wins.length) lines.push(`Recent wins not yet recognized: ${wins.map(w => w.text).join('; ')}`);
    const prep = db.prepare(`SELECT content_md FROM reports WHERE kind = 'prep' AND person_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`)
      .get(p.id, new Date(Date.now() - 7 * 864e5).toISOString());
    if (prep) lines.push(`The writer's prep for this conversation:\n${String(prep.content_md).slice(0, 1200)}`);
    background.push(lines.join('\n'));
  }
  const ctx = contextBlock(inIt.slice(0, 4).map(p => ({ kind: 'person', id: p.id, label: p.name })), { per: 3, maxChars: 800 });

  // The most recent ~3,500 characters of transcript (the last few minutes), with times.
  let budget = 3500;
  const recent = [];
  for (let i = s.parts.length - 1; i >= 0 && budget > 0; i--) {
    const t = s.parts[i].text.slice(-budget);
    recent.unshift(`[${clock(s.parts[i].at)}] ${t}`);
    budget -= t.length;
  }
  const user = [
    `Conversation: ${kindLabel(s.kind)}${s.title ? `, "${s.title}"` : ''}${inIt.length ? ` with ${inIt.map(p => p.name).join(', ')}` : ''}.`,
    background.length ? `Background:\n${background.join('\n\n')}` : '',
    ctx,
    s.suggested.length ? `Already suggested (don't repeat):\n${s.suggested.slice(-9).map(x => `- ${x}`).join('\n')}` : '',
    `Live transcript so far, oldest first (the end is what's happening now):\n${recent.join('\n')}`
  ].filter(Boolean).join('\n\n');

  const out = await complete({ system: liveSystem(settings.profile, people), messages: [{ role: 'user', content: user }], json: true, maxTokens: 700, task: 'live coach' });
  const items = (Array.isArray(out?.items) ? out.items : [])
    .filter(i => ['ask', 'say', 'note'].includes(i?.type) && clean(i.text, 200))
    .slice(0, 3).map(i => ({ type: i.type, text: clean(i.text, 200), why: clean(i.why, 100) }));
  s.suggested.push(...items.map(i => i.text));
  s.lastSuggestChars = chars(s);
  return { items, at: s.parts.at(-1)?.at || 0 };
}
