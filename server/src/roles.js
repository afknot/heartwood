// One-time tidy-up for entries made before Heartwood told "with" from "mentioned" (migration 21).
// For recorded 1:1s and conversations from the last 120 days that link more than one person, find the
// calendar or recurring meeting it was recorded in; the people on that meeting stay "with", and
// everyone else becomes "mentioned". Entries with no matching meeting are left as they were.
import { db } from './db.js';
import { agenda } from './agenda.js';

const KEY = 'roles_backfilled_v1';

export function backfillRoles() {
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KEY)) return { skipped: true };
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const rows = db.prepare(`SELECT e.id, e.created_at FROM entries e
    WHERE e.kind IN ('one_on_one', 'conversation') AND e.created_at >= ?
      AND (SELECT COUNT(*) FROM entry_people ep WHERE ep.entry_id = e.id AND ep.role = 'with') > 1`).all(since);
  const linked = db.prepare(`SELECT person_id FROM entry_people WHERE entry_id = ? AND role = 'with'`);
  const mark = db.prepare(`UPDATE entry_people SET role = 'mentioned' WHERE entry_id = ? AND person_id = ?`);
  let fixed = 0;
  for (const r of rows) {
    const at = Date.parse(r.created_at);
    let events = [];
    try { events = agenda({ days: 1, from: new Date(at - 3 * 3600e3) }); } catch { continue; }
    const ids = new Set(linked.all(r.id).map(x => x.person_id));
    // The meeting it was recorded in: starts within 90 minutes of the recording, and shares people with it.
    const ev = events
      .filter(e => Math.abs(Date.parse(e.start) - at) < 90 * 60e3 && e.people.some(p => ids.has(p.id)))
      .sort((a, b) => Math.abs(Date.parse(a.start) - at) - Math.abs(Date.parse(b.start) - at))[0];
    if (!ev) continue;
    const on = new Set(ev.people.map(p => p.id));
    const off = [...ids].filter(id => !on.has(id));
    if (!off.length || off.length === ids.size) continue;
    db.transaction(() => { for (const id of off) mark.run(r.id, id); })();
    fixed++;
  }
  // 1:1s and conversations Heartwood named after their topics ("SSO January crunch…") are renamed
  // after the person ("1:1 with Maya"). Titles you typed or changed yourself are left alone.
  const KIND_NAME = { one_on_one: '1:1', conversation: 'Conversation' };
  let renamed = 0;
  for (const e of db.prepare(`SELECT id, kind, title, analysis FROM entries WHERE kind IN ('one_on_one', 'conversation') AND created_at >= ? AND analysis IS NOT NULL`).all(since)) {
    let ai = '';
    try { ai = JSON.parse(e.analysis)?.title || ''; } catch { continue; }
    if (!ai || e.title !== ai) continue;
    const w = db.prepare(`SELECT p.name FROM entry_people ep JOIN people p ON p.id = ep.person_id WHERE ep.entry_id = ? AND ep.role = 'with'`).all(e.id);
    if (w.length !== 1) continue;
    db.prepare('UPDATE entries SET title = ? WHERE id = ?').run(`${KIND_NAME[e.kind]} with ${w[0].name.split(' ')[0]}`, e.id);
    renamed++;
  }
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(KEY, JSON.stringify({ at: new Date().toISOString(), fixed, renamed }));
  return { fixed, renamed, checked: rows.length };
}
