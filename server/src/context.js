// Context threads: updates, clarifications and "sent Sam the timeline" lines that belong with a person,
// a note or a meeting rather than in your journal. They feed Ask, prep and drafted messages.
import { db, newId, now } from './db.js';

export const KINDS = ['person', 'entry', 'meeting'];
const valid = (kind, id) => KINDS.includes(kind) && typeof id === 'string' && id.length > 0 && id.length < 300;

export function addContext({ kind, id, text, source = 'you', at = null }) {
  const t = String(text || '').trim();
  if (!valid(kind, id) || !t) throw Object.assign(new Error('Write something first.'), { status: 400 });
  const row = { id: newId(), subject_kind: kind, subject_id: id, text: t.slice(0, 4000), source: ['you', 'update', 'sent', 'moved'].includes(source) ? source : 'you', at: at || now() };
  db.prepare('INSERT INTO context_notes(id, subject_kind, subject_id, text, source, at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.subject_kind, row.subject_id, row.text, row.source, row.at);
  return row;
}

export const listContext = (kind, id, limit = 50) => (valid(kind, id)
  ? db.prepare('SELECT * FROM context_notes WHERE subject_kind = ? AND subject_id = ? ORDER BY at DESC LIMIT ?').all(kind, id, limit) : []);

export const deleteContext = id => db.prepare('DELETE FROM context_notes WHERE id = ?').run(String(id)).changes;

/** Context lines for prompts: the newest few for each subject, labeled. */
export function contextBlock(subjects = [], { per = 8, maxChars = 5000 } = {}) {
  const parts = [];
  for (const s of subjects) {
    const rows = listContext(s.kind, s.id, per);
    if (!rows.length) continue;
    parts.push(`Context the writer added about ${s.label}:\n${rows.reverse().map(r => `- ${r.at.slice(0, 10)}${r.source === 'sent' ? ' (sent)' : ''}: ${r.text.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n')}`);
  }
  return parts.join('\n\n').slice(0, maxChars);
}

/**
 * Old "Follow-up update" notes in the journal (made by Give an update) become context on the people
 * they're about, then leave the journal. Notes with files or audio, or with nobody linked, stay put.
 */
export function updateNotesPlan() {
  return db.prepare(`SELECT e.id, e.title, e.body_md, e.created_at,
      (SELECT json_group_array(ep.person_id) FROM entry_people ep WHERE ep.entry_id = e.id) AS people
    FROM entries e
    WHERE EXISTS (SELECT 1 FROM json_each(e.tags) WHERE json_each.value = 'follow-ups')
      AND e.audio_file IS NULL
      AND NOT EXISTS (SELECT 1 FROM entry_files f WHERE f.entry_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.entry_id = e.id AND f.done_at IS NULL AND f.dismissed = 0)
    ORDER BY e.created_at`).all()
    .map(r => ({ ...r, people: JSON.parse(r.people || '[]').filter(Boolean) }))
    .filter(r => r.people.length);
}

export function moveUpdateNotes() {
  const plan = updateNotesPlan();
  let moved = 0;
  db.transaction(() => {
    for (const r of plan) {
      const text = String(r.body_md || r.title || '').trim();
      if (!text) continue;
      for (const pid of r.people) addContext({ kind: 'person', id: pid, text, source: 'moved', at: r.created_at });
      // Keep any follow-ups that came from the note (and their history): unhook them first.
      db.prepare('UPDATE followups SET entry_id = NULL WHERE entry_id = ?').run(r.id);
      db.prepare('DELETE FROM entries WHERE id = ?').run(r.id);
      moved++;
    }
  })();
  return { moved };
}
