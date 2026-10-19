import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DEFAULT_SETTINGS } from './config.js';

export const db = new Database(path.join(config.dataDir, 'heartwood.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'note',          -- note | memo | conversation | one_on_one | meeting
  body_md TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  audio_file TEXT,
  audio_mime TEXT,
  audio_seconds REAL,
  status TEXT NOT NULL DEFAULT 'ready',       -- ready | transcribing | analyzing | error
  error TEXT,
  analysis TEXT,
  analysis_at TEXT,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT 'direct_report', -- direct_report | peer | manager | stakeholder | other
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_people (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, person_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- period | person
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  range_from TEXT,
  range_to TEXT,
  focus TEXT,
  content_md TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, body_md, transcript, content='entries', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, body_md, transcript) VALUES (new.rowid, new.title, new.body_md, new.transcript);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body_md, transcript) VALUES ('delete', old.rowid, old.title, old.body_md, old.transcript);
END;
CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF title, body_md, transcript ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body_md, transcript) VALUES ('delete', old.rowid, old.title, old.body_md, old.transcript);
  INSERT INTO entries_fts(rowid, title, body_md, transcript) VALUES (new.rowid, new.title, new.body_md, new.transcript);
END;
`);

// ---------- migrations (PRAGMA user_version) ----------
const MIGRATIONS = [
  // 1: document imports — keep the original text alongside the synthesized note, and search it.
  () => {
    const cols = db.prepare(`PRAGMA table_info(entries)`).all().map(c => c.name);
    for (const [c, type] of [['source', 'TEXT'], ['source_name', 'TEXT'], ['source_text', "TEXT NOT NULL DEFAULT ''"], ['source_hash', 'TEXT']]) {
      if (!cols.includes(c)) db.exec(`ALTER TABLE entries ADD COLUMN ${c} ${type}`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entries_source_hash ON entries(source_hash);
      CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        segments TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'preview',  -- preview | committed
        entry_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      DROP TRIGGER IF EXISTS entries_ai;
      DROP TRIGGER IF EXISTS entries_ad;
      DROP TRIGGER IF EXISTS entries_au;
      DROP TABLE IF EXISTS entries_fts;
      CREATE VIRTUAL TABLE entries_fts USING fts5(
        title, body_md, transcript, source_text, content='entries', content_rowid='rowid', tokenize='porter unicode61'
      );
      CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, title, body_md, transcript, source_text) VALUES (new.rowid, new.title, new.body_md, new.transcript, new.source_text);
      END;
      CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, body_md, transcript, source_text) VALUES ('delete', old.rowid, old.title, old.body_md, old.transcript, old.source_text);
      END;
      CREATE TRIGGER entries_au AFTER UPDATE OF title, body_md, transcript, source_text ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, body_md, transcript, source_text) VALUES ('delete', old.rowid, old.title, old.body_md, old.transcript, old.source_text);
        INSERT INTO entries_fts(rowid, title, body_md, transcript, source_text) VALUES (new.rowid, new.title, new.body_md, new.transcript, new.source_text);
      END;
      INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');
    `);
  },
  // 2: files attached to notes (documents, decks, spreadsheets, photos)
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS entry_files (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      stored TEXT,                         -- file name under data/files (null once deleted)
      extracted_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', -- pending | ready | error
      error TEXT,
      split_count INTEGER NOT NULL DEFAULT 0,
      split_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entry_files_entry ON entry_files(entry_id);
  `),
  // 3: keep your own context for file notes separately, so the note can be rewritten cleanly
  () => {
    const cols = db.prepare(`PRAGMA table_info(entries)`).all().map(c => c.name);
    if (!cols.includes('user_context')) db.exec(`ALTER TABLE entries ADD COLUMN user_context TEXT`);
  },
  // 4: your own note on each attached file ("notes from a previous manager", "first-round self-ranking")
  () => {
    const cols = db.prepare(`PRAGMA table_info(entry_files)`).all().map(c => c.name);
    if (!cols.includes('note')) db.exec(`ALTER TABLE entry_files ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
  },
  // 5: Today screen (follow-ups, calendar, prep), photos, chat history, passkeys
  () => {
    const pcols = db.prepare(`PRAGMA table_info(people)`).all().map(c => c.name);
    if (!pcols.includes('email')) db.exec(`ALTER TABLE people ADD COLUMN email TEXT NOT NULL DEFAULT ''`);
    if (!pcols.includes('photo')) db.exec(`ALTER TABLE people ADD COLUMN photo TEXT`); // version stamp of data/avatars/<id>.jpg
    const rcols = db.prepare(`PRAGMA table_info(reports)`).all().map(c => c.name);
    if (!rcols.includes('ref')) db.exec(`ALTER TABLE reports ADD COLUMN ref TEXT`); // e.g. calendar event key for a prep
    db.exec(`
      CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
        person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        owner TEXT NOT NULL DEFAULT '',
        due TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'ai',   -- ai | manual
        done_at TEXT,
        dismissed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_followups_entry ON followups(entry_id);
      CREATE INDEX IF NOT EXISTS idx_followups_open ON followups(done_at, dismissed);
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        messages TEXT NOT NULL DEFAULT '[]',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_events (
        key TEXT PRIMARY KEY,           -- uid + start, stable per occurrence
        uid TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        start TEXT NOT NULL,
        end TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT '',
        attendees TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY,            -- credential id (base64url)
        public_key BLOB NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT NOT NULL DEFAULT '[]',
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);
  },
  // 6: recurring conversations (a calendar-free 1:1 schedule)
  () => db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        people TEXT NOT NULL DEFAULT '[]',     -- person ids
        frequency TEXT NOT NULL DEFAULT 'weekly', -- weekly | monthly | once
        interval_weeks INTEGER NOT NULL DEFAULT 2,
        anchor_date TEXT NOT NULL,             -- YYYY-MM-DD of one real occurrence
        time TEXT NOT NULL DEFAULT '10:00',    -- HH:MM local
        duration_min INTEGER NOT NULL DEFAULT 30,
        tz TEXT NOT NULL DEFAULT 'America/New_York',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedule_exceptions (
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        date TEXT NOT NULL,                    -- the occurrence's original date
        action TEXT NOT NULL,                  -- skip | move
        new_start TEXT,                        -- ISO, when moved
        PRIMARY KEY (schedule_id, date)
      );
  `),
  // 7: where each person is (city, IANA timezone)
  () => {
    const pcols = db.prepare(`PRAGMA table_info(people)`).all().map(c => c.name);
    if (!pcols.includes('city')) db.exec(`ALTER TABLE people ADD COLUMN city TEXT NOT NULL DEFAULT ''`);
    if (!pcols.includes('tz')) db.exec(`ALTER TABLE people ADD COLUMN tz TEXT NOT NULL DEFAULT ''`);
  },
  // 8: meeting invites sent to Heartwood's own mailbox
  () => db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        uid TEXT NOT NULL,
        recurrence_id TEXT NOT NULL DEFAULT '',  -- '' = the series (or a one-off); else one changed occurrence
        sequence INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        component TEXT NOT NULL,                 -- the VEVENT, minus description/attachments
        timezones TEXT NOT NULL DEFAULT '',      -- VTIMEZONE blocks it needs
        cancelled INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL,
        PRIMARY KEY (uid, recurrence_id)
      );
      CREATE TABLE IF NOT EXISTS invite_events (
        key TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        start TEXT NOT NULL,
        end TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT '',
        attendees TEXT NOT NULL DEFAULT '[]'
      );
  `),
  // 9: who's in a meeting, set by hand (overrides automatic matching for the whole series)
  () => db.exec(`
      CREATE TABLE IF NOT EXISTS event_people (
        uid TEXT PRIMARY KEY,
        people TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
  `),
  // 10: archived follow-ups (tidied away, restorable)
  () => {
    const cols = db.prepare(`PRAGMA table_info(followups)`).all().map(c => c.name);
    if (!cols.includes('archived_at')) db.exec(`ALTER TABLE followups ADD COLUMN archived_at TEXT`);
  },
  // 11: phone notifications (Web Push subscriptions, one per device)
  () => db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        keys TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
  `),
  // 12: career record. Evidence about the writer's own work, pulled from entries and confirmed by
  // the writer, plus drafts built from it (portfolio stories, resume updates, LinkedIn update kits).
  () => db.exec(`
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'result',   -- decision | result | built | feedback | learning
        text TEXT NOT NULL,                    -- one sentence, first person, about the writer
        detail TEXT NOT NULL DEFAULT '',
        theme TEXT NOT NULL DEFAULT '',
        date TEXT,                             -- YYYY-MM-DD
        metric TEXT NOT NULL DEFAULT '',       -- a number stated in the entries, if any
        status TEXT NOT NULL DEFAULT 'suggested', -- suggested | confirmed | dismissed
        public_ok INTEGER NOT NULL DEFAULT 0,  -- writer says it's fine to use publicly (after anonymizing)
        entry_ids TEXT NOT NULL DEFAULT '[]',
        used_in TEXT NOT NULL DEFAULT '[]',    -- draft ids
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status, date);
      CREATE TABLE IF NOT EXISTS career_drafts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,                    -- story | resume | linkedin | recognition
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,                 -- story: Markdown file; resume, linkedin: JSON
        flags TEXT NOT NULL DEFAULT '[]',      -- things to check before sharing
        evidence_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',  -- draft | exported
        pr_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
  `),
  // 13: files, photos and documents attached to a question in Ask (read once, kept with the chat)
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS ask_attachments (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ask_attachments_chat ON ask_attachments(chat_id);
  `),
  // 14: each person's pronouns, so notes and coaching refer to them correctly (they/them unless set)
  () => {
    const pcols = db.prepare(`PRAGMA table_info(people)`).all().map(c => c.name);
    if (!pcols.includes('pronouns')) db.exec(`ALTER TABLE people ADD COLUMN pronouns TEXT NOT NULL DEFAULT 'they/them'`);
  },
  // 15: keep the original of a file added to a question or update, so it can be attached to a note
  () => {
    const cols = db.prepare(`PRAGMA table_info(ask_attachments)`).all().map(c => c.name);
    if (!cols.includes('stored')) db.exec(`ALTER TABLE ask_attachments ADD COLUMN stored TEXT`);
    if (!cols.includes('mime')) db.exec(`ALTER TABLE ask_attachments ADD COLUMN mime TEXT NOT NULL DEFAULT ''`);
  },
  // 16: "Something to try" on Today: one practice per day, and whether you tried it
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS practice_log (
      day TEXT PRIMARY KEY,
      practice_id TEXT NOT NULL,
      swaps INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      created_at TEXT NOT NULL
    );
  `),
  // 17: 1:1 agendas you build before a conversation (sections of items, some private to you)
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS agendas (
      id TEXT PRIMARY KEY,
      person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
      event_key TEXT,
      template TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agendas_person ON agendas(person_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agendas_event ON agendas(event_key);
  `),
  // 18: letting a follow-up go on purpose ("decided not to", "no longer needed") counts as handled
  () => {
    const cols = db.prepare(`PRAGMA table_info(followups)`).all().map(c => c.name);
    if (!cols.includes('let_go')) db.exec(`ALTER TABLE followups ADD COLUMN let_go TEXT`);
    if (!cols.includes('let_go_at')) db.exec(`ALTER TABLE followups ADD COLUMN let_go_at TEXT`);
  },
  // 19: how someone seemed to you after a conversation (your read, private): good | okay | carrying
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS person_reads (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
      read TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_person_reads ON person_reads(person_id, at);
  `)
];
{
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => { MIGRATIONS[v](); db.pragma(`user_version = ${v + 1}`); })();
  }
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

// ---------- settings ----------
export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    try {
      const v = JSON.parse(value);
      s[key] = v && typeof v === 'object' && !Array.isArray(v) && typeof s[key] === 'object'
        ? { ...s[key], ...v } : v;
    } catch { /* ignore bad rows */ }
  }
  return s;
}

export function saveSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) stmt.run(k, JSON.stringify(v));
  });
  tx();
  return getSettings();
}

// ---------- entries ----------
export function hydrateEntry(row, { withPeople = true } = {}) {
  if (!row) return null;
  const e = { ...row, tags: safeJson(row.tags, []), analysis: safeJson(row.analysis, null), consent_confirmed: !!row.consent_confirmed };
  e.has_audio = !!row.audio_file;
  delete e.audio_file;
  if (withPeople) {
    e.people = db.prepare(`SELECT p.id, p.name, p.role, p.relationship FROM people p
      JOIN entry_people ep ON ep.person_id = p.id WHERE ep.entry_id = ? ORDER BY p.name`).all(row.id);
    e.files = db.prepare(`SELECT id, name, mime, size, kind, note, status, error, split_count, split_done,
      (stored IS NOT NULL) AS has_file, extracted_text FROM entry_files WHERE entry_id = ? ORDER BY created_at, name`).all(row.id)
      .map(f => ({ ...f, has_file: !!f.has_file, split_done: !!f.split_done }));
  }
  return e;
}

export function getEntryRow(id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

export function setEntryPeople(entryId, personIds) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM entry_people WHERE entry_id = ?').run(entryId);
    const ins = db.prepare('INSERT OR IGNORE INTO entry_people(entry_id, person_id) VALUES (?, ?)');
    for (const pid of personIds || []) ins.run(entryId, pid);
  });
  tx();
}

/** Link everyone @mentioned in a note's Markdown ([@Name](/people/<id>)). Never unlinks. */
export function linkMentions(entryId, md) {
  const ids = [...new Set([...String(md || '').matchAll(/\]\(\/people\/([0-9a-f-]{36})\)/g)].map(m => m[1]))];
  if (!ids.length) return;
  const ins = db.prepare('INSERT OR IGNORE INTO entry_people(entry_id, person_id) SELECT ?, id FROM people WHERE id = ?');
  db.transaction(() => { for (const pid of ids) ins.run(entryId, pid); })();
}

export function updateEntry(id, fields) {
  const cols = ['title', 'kind', 'body_md', 'transcript', 'tags', 'audio_file', 'audio_mime', 'audio_seconds',
    'status', 'error', 'analysis', 'analysis_at', 'consent_confirmed', 'created_at', 'source_text'];
  const sets = [];
  const vals = [];
  for (const c of cols) {
    if (fields[c] === undefined) continue;
    let v = fields[c];
    if (c === 'tags' || c === 'analysis') v = v === null ? null : JSON.stringify(v);
    if (c === 'consent_confirmed') v = v ? 1 : 0;
    sets.push(`${c} = ?`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(now(), id);
  db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function safeJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export function listPeople() {
  return db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM entry_people ep WHERE ep.person_id = p.id) AS entry_count,
    (SELECT MAX(e.created_at) FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = p.id) AS last_entry_at
    FROM people p ORDER BY p.name COLLATE NOCASE`).all();
}

// Turn free text into a safe FTS5 query (each word as a prefix term, OR'd).
export function ftsQuery(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'how', 'was', 'are', 'have', 'has', 'about', 'from', 'did', 'does', 'any', 'can', 'you', 'your', 'my', 'me', 'is', 'it', 'to', 'of', 'in', 'on', 'a', 'an', 'i', 'am', 'be', 'or', 'do']);
  const terms = [...new Set(words.filter(w => !stop.has(w)))].slice(0, 12);
  // Whole word (stemmed: "delegation" also finds "delegating") OR prefix (for partial typing).
  return terms.map(t => `"${t}" OR "${t}"*`).join(' OR ');
}
