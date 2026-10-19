// "A good moment" for the top of Today: something from your own journal worth remembering.
//   lookback  a note from a month or two ago, and how much of it you've since closed out
//   praise    feedback someone gave you (from your career record)
//   win       something you made happen (from your career record)
//   kudos     a recent win on someone's growth record you haven't recognized yet
// One a day, rotating, chosen from what your journal actually has. Nothing is invented.
import { db, listPeople } from './db.js';
import { latestGrowth } from './briefs.js';
import { local } from './localtime.js';

const DAY = 864e5;
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const ago = iso => {
  const d = Math.round((Date.now() - Date.parse(iso)) / DAY);
  return d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
};
const short = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/[\s,;:.-]+\S*$/, '')}…` : t; };

function lookbacks() {
  const from = new Date(Date.now() - 75 * DAY).toISOString(), to = new Date(Date.now() - 25 * DAY).toISOString();
  return db.prepare(`SELECT e.id, e.title, e.created_at, COUNT(f.id) AS total, SUM(CASE WHEN f.done_at IS NOT NULL OR (f.dismissed = 1 AND f.let_go IS NOT NULL) THEN 1 ELSE 0 END) AS closed
    FROM entries e JOIN followups f ON f.entry_id = e.id
    WHERE e.created_at BETWEEN ? AND ? AND (f.dismissed = 0 OR f.let_go IS NOT NULL)
    GROUP BY e.id HAVING closed >= 1 ORDER BY closed * 1.0 / total DESC, e.created_at DESC LIMIT 6`).all(from, to)
    .map(r => ({
      kind: 'lookback', key: `lookback:${r.id}`, title: `Looking back, ${ago(r.created_at)}`,
      text: `You wrote “${short(r.title || 'a note', 80)}.” Since then you’ve closed ${r.closed === r.total ? `all ${r.total}` : `${r.closed} of ${r.total}`} of its follow-ups.`,
      action: { label: 'Read it', to: `/entry/${r.id}` }
    }));
}

function evidence(kinds, days) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  return db.prepare(`SELECT id, kind, text, date FROM evidence WHERE status != 'dismissed' AND kind IN (${kinds.map(() => '?').join(',')}) AND COALESCE(date, substr(created_at, 1, 10)) >= ? ORDER BY COALESCE(date, created_at) DESC LIMIT 8`)
    .all(...kinds, since);
}

function praise() {
  return evidence(['feedback'], 365).map(r => ({
    kind: 'praise', key: `praise:${r.id}`, title: 'Something said about your work',
    text: short(r.text, 200) + (r.date ? ` (${ago(`${r.date}T12:00:00Z`)})` : ''), action: { label: 'Career record', to: '/career' }
  }));
}

function wins() {
  return evidence(['outcome', 'initiative', 'leadership', 'result', 'built'], 120).map(r => ({
    kind: 'win', key: `win:${r.id}`, title: 'Something you made happen',
    text: short(r.text, 200), action: { label: 'Career record', to: '/career' }
  }));
}

function kudos() {
  const out = [];
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  for (const p of listPeople().filter(x => x.relationship === 'direct_report')) {
    let g;
    try { g = latestGrowth(p.id); } catch { g = null; }
    const recent = (g?.timeline || []).filter(t => (t.type === 'win' || t.type === 'milestone') && t.date && t.date >= since);
    if (!recent.length) continue;
    const last = recent.at(-1);
    const given = db.prepare(`SELECT 1 FROM career_drafts WHERE kind = 'recognition' AND title LIKE ? AND created_at >= ?`).get(`%${p.name}%`, `${last.date}T00:00:00Z`);
    if (given) continue;
    out.push({
      kind: 'kudos', key: `kudos:${p.id}:${last.date}`, title: 'A win worth recognizing', person: { id: p.id, name: p.name, photo: p.photo },
      text: `${p.name.split(' ')[0]}: ${short(last.text, 170)}`, action: { label: 'Give kudos', to: `/career?recognize=${p.id}#drafts` }
    });
  }
  return out;
}

/** Today's good moment, or null when the journal doesn't have one yet. */
export function goodMoment(ymd = local().ymd) {
  const safe = fn => { try { return fn(); } catch { return []; } };
  const groups = [safe(kudos), safe(lookbacks), safe(praise), safe(wins)].filter(g => g.length);
  if (!groups.length) return null;
  const h = hash(ymd);
  const group = groups[h % groups.length];
  return group[Math.floor(h / groups.length) % group.length];
}
