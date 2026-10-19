// Your voice: how you write, learned from you, so drafted messages sound like you.
//
// It learns from three kinds of writing, all kept on your server:
//   exercise  short prompts you answer (different situations and audiences), the quickest start
//   example   messages you've actually sent, pasted in
//   edited    a drafted message you changed and then used: the strongest signal, it shows what you fix
// From these Heartwood writes a style profile (tone, length, greetings, sign-offs, habits, and how you
// shift by audience). It refreshes on its own every few new samples, so it keeps getting closer.
import { db, newId, now, getSettings } from './db.js';
import { complete } from './llm.js';
import { config } from './config.js';

export const AUDIENCES = { direct_report: 'someone on your team', peer: 'a peer', manager: 'your manager', stakeholder: 'a stakeholder or partner', team: 'your whole team' };
export const CHANNELS = ['email', 'slack', 'text'];

export const EXERCISES = [
  { id: 'praise', audience: 'direct_report', channel: 'slack', title: 'Recognize good work',
    prompt: 'Someone on your team did something this week that made a real difference. Send them a quick note saying so.' },
  { id: 'feedback', audience: 'direct_report', channel: 'slack', title: 'Give hard feedback',
    prompt: 'A meeting someone on your team ran went off track and ran over. Send them a message to set up a chat about it, and say what you noticed.' },
  { id: 'decline', audience: 'peer', channel: 'email', title: 'Say no to a peer',
    prompt: 'A peer asks your team to take on a project you don’t have room for this quarter. Say no, kindly, and offer what you can.' },
  { id: 'slip', audience: 'manager', channel: 'email', title: 'Bad news to your manager',
    prompt: 'Tell your manager a deadline is going to slip by two weeks, why, and what you’re doing about it.' },
  { id: 'nudge', audience: 'stakeholder', channel: 'email', title: 'Nudge for a decision',
    prompt: 'A stakeholder hasn’t replied about a decision your team is blocked on. Follow up without sounding annoyed.' },
  { id: 'change', audience: 'team', channel: 'slack', title: 'Announce a change',
    prompt: 'Let your whole team know about a change to how you’ll run planning, and why.' },
  { id: 'slammed', audience: 'peer', channel: 'slack', title: 'A quick reply',
    prompt: 'Someone pings you “got a minute?” while you’re slammed. Reply.' }
];

const clean = (s, n) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);
const REFRESH_EVERY = 3;

export function listSamples(limit = 60) {
  return db.prepare('SELECT id, text, kind, channel, audience, situation, at FROM writing_samples ORDER BY at DESC LIMIT ?').all(limit);
}

export function addSample({ text, kind = 'example', channel = '', audience = '', situation = '' }) {
  const t = clean(text, 4000);
  if (t.length < 20) throw Object.assign(new Error('Write a sentence or two at least.'), { status: 400 });
  const ex = EXERCISES.find(e => e.id === situation);
  // Answering an exercise again replaces your earlier answer.
  if (kind === 'exercise' && ex) db.prepare(`DELETE FROM writing_samples WHERE kind = 'exercise' AND situation = ?`).run(ex.id);
  const id = newId();
  db.prepare('INSERT INTO writing_samples(id, text, kind, channel, audience, situation, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, t, ['exercise', 'example', 'edited'].includes(kind) ? kind : 'example',
    CHANNELS.includes(channel) ? channel : ex?.channel || '', AUDIENCES[audience] ? audience : ex?.audience || '', clean(situation, 60), now());
  db.prepare(`DELETE FROM writing_samples WHERE kind != 'exercise' AND id NOT IN (SELECT id FROM writing_samples WHERE kind != 'exercise' ORDER BY at DESC LIMIT 60)`).run();
  maybeRefresh();
  return id;
}
export function deleteSample(id) { const n = db.prepare('DELETE FROM writing_samples WHERE id = ?').run(String(id)).changes; return n; }

// ---------- the profile ----------
const readProfile = () => { try { return JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'voice_profile'`).get()?.value || 'null'); } catch { return null; } };
const saveProfile = p => db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('voice_profile', ?)`).run(JSON.stringify(p));
const sampleCount = () => db.prepare('SELECT COUNT(*) AS n FROM writing_samples').get().n;

let refreshing = null;
function maybeRefresh() {
  const p = readProfile();
  const n = sampleCount();
  if (n < 2) return;
  if (!p || n - (p.sample_count || 0) >= REFRESH_EVERY || (n < 6 && n !== p.sample_count)) refreshProfile().catch(err => console.error('[voice]', err.message));
}

const PROFILE_SYSTEM = `You study how one person writes so an assistant can draft messages that sound like them.
You get samples of their writing: exercise answers (with the situation and audience), messages they sent, and drafts they edited (the edited version is theirs). Describe their style concretely enough that someone could imitate it, without quoting more than a few words from any sample.

Return JSON only:
{"summary":"2-3 sentences: how they come across in writing",
 "traits":["5-8 short, concrete habits: length, sentence shape, warmth, directness, punctuation, emoji, contractions, how they open and close"],
 "greetings":["how they usually open"], "signoffs":["how they usually close"],
 "by_audience":{"direct_report":"how they write to their team","peer":"…","manager":"…","stakeholder":"…","team":"…"},
 "avoid":["things that would not sound like them"],
 "gaps":"one sentence: which situations or audiences have no samples yet"}
Leave out an audience in by_audience when there are no samples for it.`;

export async function refreshProfile() {
  if (refreshing) return refreshing;
  if (!config.keys[getSettings().ai_provider]) return readProfile();
  refreshing = (async () => {
    const samples = listSamples(30);
    if (samples.length < 2) return readProfile();
    const user = samples.map((s, i) => {
      const ex = EXERCISES.find(e => e.id === s.situation);
      const meta = [s.kind, s.channel, s.audience && AUDIENCES[s.audience], ex && `situation: ${ex.prompt}`].filter(Boolean).join(' · ');
      return `<sample ${i + 1} ${meta}>\n${s.text.slice(0, 1500)}\n</sample>`;
    }).join('\n\n');
    const out = await complete({ system: PROFILE_SYSTEM, messages: [{ role: 'user', content: user }], json: true, maxTokens: 1800 });
    const list = v => (Array.isArray(v) ? v : []).map(x => clean(x, 200)).filter(Boolean).slice(0, 8);
    const by = {};
    for (const k of Object.keys(AUDIENCES)) if (out?.by_audience?.[k]) by[k] = clean(out.by_audience[k], 300);
    const profile = { summary: clean(out?.summary, 600), traits: list(out?.traits), greetings: list(out?.greetings), signoffs: list(out?.signoffs), by_audience: by, avoid: list(out?.avoid), gaps: clean(out?.gaps, 300), sample_count: samples.length >= 30 ? sampleCount() : samples.length, at: now() };
    saveProfile(profile);
    return profile;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** In your own words: anything Heartwood should know about how you write. Kept with the profile. */
export function setOwnWords(text) {
  const p = readProfile() || { sample_count: 0 };
  p.own_words = clean(text, 1500);
  saveProfile(p);
  return voiceStatus();
}

export function voiceStatus() {
  const samples = listSamples();
  const done = new Set(samples.filter(s => s.kind === 'exercise').map(s => s.situation));
  return {
    profile: readProfile(),
    exercises: EXERCISES.map(e => ({ ...e, audience_label: AUDIENCES[e.audience], done: done.has(e.id), answer: samples.find(s => s.kind === 'exercise' && s.situation === e.id)?.text || '' })),
    samples: samples.filter(s => s.kind !== 'exercise').map(s => ({ ...s, text: s.text.slice(0, 600) })),
    counts: { exercise: done.size, example: samples.filter(s => s.kind === 'example').length, edited: samples.filter(s => s.kind === 'edited').length },
    refreshing: !!refreshing
  };
}

/** The voice guidance for drafting a message to this audience on this channel. */
export function voiceBlock({ audience = '', channel = '' } = {}) {
  const p = readProfile();
  const all = listSamples(60);
  // Closest examples first: same audience and channel, then same audience, then same channel; edited drafts rank high.
  const score = s => (s.audience === audience ? 4 : 0) + (s.channel === channel ? 2 : 0) + (s.kind === 'edited' ? 1.5 : s.kind === 'exercise' ? 1 : 0);
  const pick = [...all].sort((a, b) => score(b) - score(a) || b.at.localeCompare(a.at)).slice(0, 4);
  const parts = [];
  if (p?.own_words) parts.push(`In the writer's own words, about how they write: ${p.own_words}`);
  if (p?.summary) {
    parts.push(`How the writer writes (learned from ${p.sample_count} samples):\n${p.summary}`);
    if (p.traits?.length) parts.push(`Habits:\n${p.traits.map(t => `- ${t}`).join('\n')}`);
    if (audience && p.by_audience?.[audience]) parts.push(`Writing to ${AUDIENCES[audience]}: ${p.by_audience[audience]}`);
    if (p.greetings?.length || p.signoffs?.length) parts.push(`Usual openings: ${p.greetings.join(' / ') || '(varies)'}. Usual closings: ${p.signoffs.join(' / ') || '(varies)'}.`);
    if (p.avoid?.length) parts.push(`Doesn't sound like them: ${p.avoid.join('; ')}`);
  }
  if (pick.length) parts.push(`Samples of their own writing (match the voice, not the content):\n${pick.map((s, i) => `<sample ${i + 1}${s.audience ? ` to="${AUDIENCES[s.audience]}"` : ''}${s.channel ? ` channel="${s.channel}"` : ''}>\n${s.text.slice(0, 1200)}\n</sample>`).join('\n')}`);
  return parts.length ? parts.join('\n\n') : 'No samples of the writer’s own messages yet: write plainly and warmly, like a thoughtful manager, not like a template.';
}
