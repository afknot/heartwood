// Kudos for the people you work with: what's worth recognizing, and sending it where it belongs.
// Drafts are career_drafts of kind 'recognition' (made in career.js). Each one has a line to say in
// your 1:1, a message to them, a team-channel shout-out, a LinkedIn post and a recommendation.
//
// Sending only happens when you tap Send. Slack goes out as you (your own user token); a Teams
// channel post goes through the channel's Workflows webhook. A Teams chat to them opens in Teams
// with the message filled in, for you to send.
import { db, safeJson, now } from './db.js';
import { latestGrowth } from './briefs.js';
import { secret } from './vault.js';
import { safeFetch } from './netguard.js';
import { addContext } from './context.js';

const DAY = 864e5;
export class KudosError extends Error {}

/** Wins and milestones from someone's growth record since you last gave them kudos (last 45 days). */
export function pendingWins(person, { days = 45 } = {}) {
  let g = null;
  try { g = latestGrowth(person.id); } catch { /* no growth record yet */ }
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const lastGiven = db.prepare(`SELECT created_at FROM career_drafts WHERE kind = 'recognition' AND title LIKE ? ORDER BY created_at DESC LIMIT 1`)
    .get(`%${person.name}%`)?.created_at?.slice(0, 10) || '';
  return (g?.timeline || []).filter(t => (t.type === 'win' || t.type === 'milestone') && t.date && t.date >= since && t.date > lastGiven)
    .map(t => ({ date: t.date, text: String(t.text || '').trim() })).filter(t => t.text).slice(-4);
}

/** Your latest kudos draft for someone in the last 30 days, if any. */
export function recentKudos(person) {
  const r = db.prepare(`SELECT * FROM career_drafts WHERE kind = 'recognition' AND title LIKE ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .get(`%${person.name}%`, new Date(Date.now() - 30 * DAY).toISOString());
  if (!r) return null;
  const c = safeJson(r.content, {});
  return c.person_id && c.person_id !== person.id ? null : { id: r.id, created_at: r.created_at, ...c };
}

/** What's set up, for the buttons on a kudos draft. Never the token or webhook itself. */
export function kudosChannels() {
  return { slack: !!secret('slack_token'), slack_channel: secret('slack_channel') || '', teams_channel: !!secret('teams_webhook_url') };
}

// ---------- Slack (Web API, as you) ----------
async function slack(method, params, { form = false } = {}) {
  const token = secret('slack_token');
  if (!token) throw new KudosError('Connect Slack in Settings → Slack & Teams first.');
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8' },
    body: form ? new URLSearchParams(params).toString() : JSON.stringify(params),
    signal: AbortSignal.timeout(20000)
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    const why = {
      invalid_auth: 'Slack turned down the token. Paste it again in Settings.', not_authed: 'Slack turned down the token. Paste it again in Settings.',
      users_not_found: 'Slack has no one with that email. Check their email on their page in Heartwood.',
      channel_not_found: 'Slack couldn’t find that channel. Check the name, and that you’re in it.',
      not_in_channel: 'Join that channel in Slack first.', missing_scope: `The Slack token is missing a permission (${j.needed || 'see Settings'}).`,
      is_archived: 'That channel is archived.', restricted_action: 'Your Slack workspace doesn’t allow this post.'
    }[j.error];
    throw new KudosError(why || `Slack said: ${j.error || res.status}`);
  }
  return j;
}

async function slackUserId(email) {
  if (!email) return null;
  try { return (await slack('users.lookupByEmail', { email }, { form: true })).user?.id || null; } catch { return null; }
}

/** Swap their name (full, else first) for a Slack @mention, once. */
const mention = (text, person, uid) => {
  if (!uid) return text;
  for (const n of [person.name, person.name.split(' ')[0]]) {
    const i = text.indexOf(n);
    if (n && i >= 0) return `${text.slice(0, i)}<@${uid}>${text.slice(i + n.length)}`;
  }
  return text;
};

// ---------- Teams channel (Workflows webhook) ----------
async function teamsChannel(text) {
  const url = secret('teams_webhook_url');
  if (!url) throw new KudosError('Add your Teams channel’s webhook in Settings → Slack & Teams first.');
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
        body: [{ type: 'TextBlock', text, wrap: true }]
      } }]
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok && res.status !== 202) throw new KudosError(`Teams didn’t take the post (${res.status}). Check the webhook in Settings.`);
}

/**
 * Send part of a kudos draft. to: 'slack_dm' | 'slack_channel' | 'teams_channel'.
 * Records where it went on the draft and in their context thread.
 */
export async function sendKudos({ draftId, to, text }) {
  const row = db.prepare(`SELECT * FROM career_drafts WHERE id = ? AND kind = 'recognition'`).get(draftId);
  if (!row) throw Object.assign(new KudosError('Not found'), { status: 404 });
  const c = safeJson(row.content, {});
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(c.person_id);
  if (!person) throw new KudosError('This kudos isn’t linked to anyone in Heartwood anymore.');
  const body = String(text || '').trim().slice(0, 3000);
  if (!body) throw new KudosError('Write the message first.');

  let where;
  if (to === 'slack_dm') {
    if (!person.email) throw new KudosError(`Add ${person.name.split(' ')[0]}’s work email on their page so Slack can find them.`);
    const uid = await slackUserId(person.email);
    if (!uid) throw new KudosError(`Slack has no one with ${person.email}. Check their email on their page.`);
    const im = await slack('conversations.open', { users: uid });
    await slack('chat.postMessage', { channel: im.channel.id, text: body });
    where = 'a Slack message to them';
  } else if (to === 'slack_channel') {
    const channel = secret('slack_channel').replace(/^#/, '');
    if (!channel) throw new KudosError('Pick a Slack channel for kudos in Settings → Slack & Teams.');
    const uid = await slackUserId(person.email);
    await slack('chat.postMessage', { channel, text: mention(body, person, uid) });
    where = `Slack #${channel}`;
  } else if (to === 'teams_channel') {
    await teamsChannel(body);
    where = 'the Teams channel';
  } else throw new KudosError('Pick where to send it.');

  const sent = [...(Array.isArray(c.sent) ? c.sent : []), { to, at: now() }];
  db.prepare('UPDATE career_drafts SET content = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...c, sent }), now(), row.id);
  try { addContext({ kind: 'person', id: person.id, text: `Sent kudos in ${where}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`, source: 'sent' }); } catch { /* best effort */ }
  return { ok: true, where, sent };
}

/** Note that you gave kudos somewhere Heartwood didn't send it (said it in the 1:1, Teams chat, LinkedIn). */
export function markGiven({ draftId, to }) {
  const row = db.prepare(`SELECT * FROM career_drafts WHERE id = ? AND kind = 'recognition'`).get(draftId);
  if (!row) throw Object.assign(new KudosError('Not found'), { status: 404 });
  const c = safeJson(row.content, {});
  const label = { say: 'Said it in person', teams_dm: 'Sent a Teams message', linkedin: 'Posted on LinkedIn', recommendation: 'Wrote a LinkedIn recommendation', copied: 'Copied it' }[to];
  if (!label) throw new KudosError('Unknown');
  const sent = [...(Array.isArray(c.sent) ? c.sent : []), { to, at: now() }];
  db.prepare('UPDATE career_drafts SET content = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...c, sent }), now(), row.id);
  if (c.person_id && to !== 'copied') { try { addContext({ kind: 'person', id: c.person_id, text: `${label}: kudos for ${String(c.win || '').slice(0, 200)}`, source: 'sent' }); } catch { /* best effort */ } }
  return { ok: true, sent };
}
