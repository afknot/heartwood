// Kudos for the people you work with: what's worth recognizing, and noting where you gave it.
// Drafts are career_drafts of kind 'recognition' (made in career.js). Each one has a line to say in
// your 1:1, a message to them, a shout-out for the team, a LinkedIn post and a recommendation.
// Heartwood never sends any of it: you copy it, or open LinkedIn with the post filled in.
import { db, safeJson, now } from './db.js';
import { latestGrowth } from './briefs.js';
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

/** Note that you gave kudos: said it, sent the message, shared it with the team, posted on LinkedIn. */
export function markGiven({ draftId, to }) {
  const row = db.prepare(`SELECT * FROM career_drafts WHERE id = ? AND kind = 'recognition'`).get(draftId);
  if (!row) throw Object.assign(new KudosError('Not found'), { status: 404 });
  const c = safeJson(row.content, {});
  const label = { say: 'Said it in person', message: 'Sent them a message', team: 'Shared it with the team', linkedin: 'Posted on LinkedIn', recommendation: 'Wrote a LinkedIn recommendation' }[to];
  if (!label) throw new KudosError('Unknown');
  const prev = Array.isArray(c.sent) ? c.sent : [];
  if (prev.some(x => x.to === to)) return { ok: true, sent: prev };
  const sent = [...prev, { to, at: now() }];
  db.prepare('UPDATE career_drafts SET content = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...c, sent }), now(), row.id);
  if (c.person_id) { try { addContext({ kind: 'person', id: c.person_id, text: `${label}: kudos for ${String(c.win || '').slice(0, 200)}`, source: 'sent' }); } catch { /* best effort */ } }
  return { ok: true, sent };
}
