// Write a message to someone, in your own words: draft from scratch, improve your draft, or reply to
// theirs. Uses what your journal knows about the person, note or meeting, and samples of how you
// write. Heartwood never sends anything: you copy it or open it in your mail app.
import { db, getSettings, listPeople, hydrateEntry } from './db.js';
import { complete } from './llm.js';
import { profileBlock, entryDigest } from './prompts.js';
import { listFollowups } from './followups.js';
import { contextBlock } from './context.js';
import { meetingDetail } from './calendar.js';
import { addSample, voiceBlock } from './voice.js';

const CHANNELS = {
  email: 'an email: a subject line, a greeting, short paragraphs, a sign-off that matches the writer’s samples',
  slack: 'a Slack or Teams message: no subject, no formal greeting or sign-off, one to four short paragraphs or a few bullets',
  text: 'a text message: one to three sentences, casual'
};
const MODES = { new: 'Draft a new message from what the writer wants to say.', improve: 'Improve the writer’s draft: clearer, tighter and kinder where it helps, keeping their voice, their meaning and anything specific they wrote. Don’t add new claims.', reply: 'Write the writer’s reply to the message they received, saying what the writer wants to say.' };

const clean = (s, n) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);

// ---------- what the journal knows ----------
function subjectContext({ kind, id }) {
  const people = listPeople();
  let recipients = [], about = '', subjects = [];
  if (kind === 'person') {
    const p = people.find(x => x.id === id);
    if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
    recipients = [p];
    subjects = [{ kind: 'person', id: p.id, label: p.name }];
  } else if (kind === 'entry') {
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    const e = hydrateEntry(row);
    recipients = (e.people || []).map(x => people.find(p => p.id === x.id)).filter(Boolean);
    about = `The message is about this note:\n${entryDigest(e, 6000)}`;
    subjects = [{ kind: 'entry', id, label: `the note “${e.title || 'Untitled'}”` }, ...recipients.map(p => ({ kind: 'person', id: p.id, label: p.name }))];
  } else if (kind === 'meeting') {
    const m = meetingDetail(id, people, getSettings().profile?.name);
    if (!m) throw Object.assign(new Error('Not found'), { status: 404 });
    recipients = (m.people || []).map(x => people.find(p => p.id === x.id)).filter(Boolean);
    about = `The message is about the meeting “${m.title}”${m.start ? ` (${String(m.start).slice(0, 16).replace('T', ' ')} UTC)` : ''}.`;
    subjects = [{ kind: 'meeting', id, label: `the meeting “${m.title}”` }, ...recipients.map(p => ({ kind: 'person', id: p.id, label: p.name }))];
  } else throw Object.assign(new Error('Pick who it’s for.'), { status: 400 });

  const ids = recipients.map(p => p.id);
  const rows = ids.length ? db.prepare(`SELECT DISTINCT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id IN (${ids.map(() => '?').join(',')}) ORDER BY e.created_at DESC LIMIT 5`).all(...ids) : [];
  const recent = rows.map(r => hydrateEntry(r)).reverse();
  const open = listFollowups({ status: 'open', limit: 500 }).filter(f => f.person_id && ids.includes(f.person_id)).slice(0, 12);
  const who = recipients.map(p => `${p.name}${p.pronouns ? ` (${p.pronouns})` : ''}${p.role ? `, ${p.role}` : ''}${p.relationship === 'direct_report' ? ', reports to the writer' : p.relationship === 'manager' ? ', the writer’s manager' : p.relationship === 'peer' ? ', a peer' : ''}${p.notes ? `. Writer's notes on them: ${p.notes.slice(0, 600)}` : ''}`).join('\n');
  const block = [
    recipients.length ? `Writing to:\n${who}` : 'Writing to: (whoever the writer names)',
    about,
    open.length ? `Open commitments between them:\n${open.map(f => `- ${f.mine ? 'Writer owes' : `${f.person_name || 'They'} owe`}: ${f.text}${f.due ? ` (due ${f.due})` : ''}`).join('\n')}` : '',
    contextBlock(subjects),
    recent.length ? `Recent journal notes involving them (background only, oldest first):\n${recent.map(e => entryDigest(e, 1200)).join('\n\n---\n\n')}` : ''
  ].filter(Boolean).join('\n\n');
  return { recipients, block, others: people.filter(p => !ids.includes(p.id)) };
}

const SYSTEM = ({ mode, channel, profile }) => `You help a people manager write messages in their own voice.

${profileBlock(profile)}

${MODES[mode]} It will be ${CHANNELS[channel]}.

Rules:
- Sound like the writer, not like an assistant. Match their samples. Plain, warm, direct. No corporate filler, no "I hope this finds you well", no exclamation-mark enthusiasm unless their samples use it.
- Use the journal only for background the writer clearly intends to share. Never include private observations from the journal (how someone seemed, coaching notes, concerns about anyone, anything about other people) unless the writer's own input says it.
- Don't invent facts, dates, numbers or commitments. Where something needed is missing, write [like this] for the writer to fill in.
- Respect the recipient's pronouns.
- Give exactly two versions that differ in approach, not just wording, with a 1-3 word label each (e.g. "Warmer" / "More direct", "Short" / "With context", "Firm no" / "Soft no"). Pick the pair that fits this message.
${mode === 'improve' ? '- Also list up to 5 changes you made to the draft and why, briefly.\n' : ''}- Flag anything in your versions the writer should double-check before sending (a detail that came from private notes, a commitment, a sensitive topic).

Return JSON only:
{"variants":[{"label":"…","subject":"${channel === 'email' ? 'subject line' : ''}","text":"the message"}],${mode === 'improve' ? '"changes":[{"what":"…","why":"…"}],' : ''}"flags":["…"]}`;

/** Two versions of the message, plus changes (when improving) and things to check. */
export async function compose({ subject, mode = 'new', channel = 'email', text = '', their = '' }) {
  if (!MODES[mode]) mode = 'new';
  if (!CHANNELS[channel]) channel = 'email';
  const input = clean(text, 8000), theirs = clean(their, 8000);
  if (!input && mode !== 'reply') throw Object.assign(new Error(mode === 'improve' ? 'Paste your draft first.' : 'Say what you want to get across, even as rough notes.'), { status: 400 });
  if (mode === 'reply' && !theirs) throw Object.assign(new Error('Paste the message you’re replying to.'), { status: 400 });
  const { recipients, block, others } = subjectContext(subject || {});
  const profile = getSettings().profile || {};
  const audience = recipients.length > 2 ? 'team' : recipients[0]?.relationship || '';
  const user = [
    block,
    '',
    voiceBlock({ audience, channel }),
    '',
    theirs ? `The message they sent (reply to this):\n<their_message>\n${theirs}\n</their_message>` : '',
    mode === 'improve' ? `The writer's draft:\n<draft>\n${input}\n</draft>` : `What the writer wants to say${mode === 'reply' ? ' in reply' : ''}:\n<intent>\n${input || '(not given: write a sensible, kind reply)'}\n</intent>`
  ].filter(Boolean).join('\n');
  const out = await complete({ system: SYSTEM({ mode, channel, profile }), messages: [{ role: 'user', content: user }], json: true, maxTokens: 3000 });
  const variants = (Array.isArray(out?.variants) ? out.variants : []).slice(0, 2).map(v => ({
    label: clean(v.label, 30) || 'Version', subject: channel === 'email' ? clean(v.subject, 200) : '', text: clean(v.text, 8000)
  })).filter(v => v.text);
  if (!variants.length) throw Object.assign(new Error('Couldn’t draft that. Try again, or say a little more about what you want to say.'), { status: 502 });
  const flags = (Array.isArray(out?.flags) ? out.flags : []).map(f => clean(typeof f === 'string' ? f : f?.text, 240)).filter(Boolean).slice(0, 5);
  // Our own check: people from your journal named in a version, who aren't on the message and you didn't mention.
  const said = `${input} ${theirs}`.toLowerCase();
  for (const p of others) {
    const name = p.name.split(' ')[0];
    if (name.length < 3 || said.includes(name.toLowerCase())) continue;
    if (variants.some(v => new RegExp(`\\b${name.replace(/[^\p{L}'-]/gu, '')}\\b`, 'u').test(v.text))) flags.unshift(`Mentions ${p.name}, who isn’t on this message. Check that’s meant to be shared.`);
  }
  return {
    variants, flags: [...new Set(flags)].slice(0, 6),
    changes: mode === 'improve' ? (Array.isArray(out?.changes) ? out.changes : []).slice(0, 5).map(c => ({ what: clean(c?.what, 200), why: clean(c?.why, 200) })).filter(c => c.what) : [],
    recipients: recipients.map(p => ({ id: p.id, name: p.name, email: p.email || '' })), audience
  };
}

/**
 * You used a draft. If you changed it, it becomes a sample of your voice, so the next one is closer.
 * Optionally notes "Sent …" on the person's context thread (not your journal).
 */
export function usedDraft({ text, original = '', channel = '', audience = '', log = false, subjects = [] }) {
  const t = clean(text, 8000);
  if (!t) return { ok: false };
  const norm = s => s.replace(/\s+/g, ' ').trim();
  let learned = false;
  if (norm(t) !== norm(clean(original, 8000)) && t.length >= 20) { addSample({ text: t, kind: 'edited', channel, audience }); learned = true; }
  return { ok: true, learned, log: !!log, subjects };
}
