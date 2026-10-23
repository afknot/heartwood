// Meeting invites sent to Heartwood's own mailbox.
//
// You add Heartwood's address (e.g. heartwood@yourdomain.com) to a meeting, or forward one to it.
// Every few minutes Heartwood checks that mailbox over IMAP, reads the calendar part of each invite
// (new meeting, new time, cancelled occurrence, cancelled series) and shows it on Today.
// It never replies or RSVPs. Only senders on INVITE_ALLOWED_FROM are read; everything else is ignored.
// Meeting descriptions, agendas, join links and attachments are dropped; processed mail is deleted after a week.
import { db, now } from './db.js';
import { parseEvents } from './calendar.js';
import { cleanTitle } from './ics.js';
import { secret } from './vault.js';

const env = k => (process.env[k] || '').trim();
export const inviteConfig = () => ({
  host: secret('invite_imap_host'),
  port: Number(secret('invite_imap_port') || 993),
  user: secret('invite_email'),
  pass: secret('invite_password'),
  allowed: [...new Set([...envAllowed(), ...appAllowed()])]
});

// Allowed senders come from .env (INVITE_ALLOWED_FROM) and from Settings in the app.
const envAllowed = () => env('INVITE_ALLOWED_FROM').toLowerCase().split(/[\s,;]+/).filter(Boolean);
const ALLOWED_KEY = '_invite_allowed_from';
function appAllowed() {
  try { return JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(ALLOWED_KEY)?.value || '[]'); } catch { return []; }
}
const saveAllowed = list => db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run(ALLOWED_KEY, JSON.stringify([...new Set(list)].slice(0, 50)));

/** "you@work.example" or "@work.example" (everyone there). Returns the cleaned value or throws. */
export function cleanSender(v) {
  const x = String(v || '').trim().toLowerCase().replace(/^mailto:/, '');
  if (/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(x) || /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(x)) return x;
  throw new Error('Enter an email address, or @domain for everyone there.');
}
export function allowSender(v) { const x = cleanSender(v); saveAllowed([...appAllowed(), x]); return x; }
export function disallowSender(v) { const x = String(v || '').trim().toLowerCase(); saveAllowed(appAllowed().filter(a => a !== x)); }
const configured = c => !!(c.host && c.user && c.pass);

const state = { lastCheck: null, error: null, checking: false, lastResult: null };
const POLL_MIN = 5;
const KEEP_MAIL_DAYS = 7;

// ---------- iCalendar text helpers ----------
const unfold = t => String(t).replace(/\r?\n[ \t]/g, '');
const prop = (block, name) => {
  const m = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, 'mi').exec(unfold(block));
  return m ? { params: m[1] || '', value: m[2].trim() } : null;
};
const blocks = (text, type) => String(text).match(new RegExp(`BEGIN:${type}\\r?\\n[\\s\\S]*?\\r?\\nEND:${type}`, 'g')) || [];

/** Remove properties we don't want to keep (with their folded continuation lines). */
function stripProps(block, names) {
  const lines = String(block).split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) { if (!skipping) out.push(line); continue; }
    const name = line.split(/[;:]/)[0].toUpperCase();
    skipping = names.includes(name);
    if (!skipping) out.push(line);
  }
  return out.join('\r\n');
}
const DROP = ['DESCRIPTION', 'X-ALT-DESC', 'ATTACH', 'COMMENT', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-MICROSOFT-ONLINEMEETINGINFORMATION', 'X-MICROSOFT-ONLINEMEETINGCONFLINK', 'X-MICROSOFT-LOCATIONS'];

/** Normalise a RECURRENCE-ID to a stable string (its raw value incl. TZID is fine as a key). */
const recurrenceKey = block => { const r = prop(block, 'RECURRENCE-ID'); return r ? `${r.params}:${r.value}` : ''; };

/**
 * Apply one calendar (from one email) to the stored invites.
 * Returns a short summary for the status line, e.g. { added: 1, updated: 0, cancelled: 0 }.
 */
export function applyCalendar(icsText) {
  const text = String(icsText);
  const method = (prop(blocks(text, 'VCALENDAR')[0] || text, 'METHOD')?.value || 'PUBLISH').toUpperCase();
  if (['REPLY', 'COUNTER', 'DECLINECOUNTER', 'REFRESH'].includes(method)) return { ignored: 1 }; // RSVPs etc.
  const tzs = blocks(text, 'VTIMEZONE').join('\r\n');
  const result = { added: 0, updated: 0, cancelled: 0 };
  const get = db.prepare('SELECT sequence FROM invites WHERE uid = ? AND recurrence_id = ?');
  const upsert = db.prepare(`INSERT INTO invites(uid, recurrence_id, sequence, title, component, timezones, cancelled, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid, recurrence_id) DO UPDATE SET sequence = excluded.sequence, title = excluded.title, component = excluded.component,
      timezones = excluded.timezones, cancelled = excluded.cancelled, received_at = excluded.received_at`);
  db.transaction(() => {
    for (const raw of blocks(text, 'VEVENT')) {
      const uid = prop(raw, 'UID')?.value;
      if (!uid) continue;
      const rid = recurrenceKey(raw);
      const seq = Number(prop(raw, 'SEQUENCE')?.value || 0);
      const prev = get.get(uid, rid);
      if (prev && seq < prev.sequence) continue; // an older update arriving late
      const title = cleanTitle((prop(raw, 'SUMMARY')?.value || '').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ')).slice(0, 300);
      const cancelSeries = method === 'CANCEL' && !rid;
      let component = stripProps(raw, DROP);
      if (method === 'CANCEL' && rid && !/^STATUS:/mi.test(component)) component = component.replace(/\r?\nEND:VEVENT$/, '\r\nSTATUS:CANCELLED\r\nEND:VEVENT');
      upsert.run(uid, rid, seq, title, component, tzs, cancelSeries || /^STATUS:CANCELLED/mi.test(component) ? 1 : 0, now());
      if (cancelSeries) db.prepare('UPDATE invites SET cancelled = 1 WHERE uid = ?').run(uid);
      if (method === 'CANCEL') result.cancelled++; else if (prev) result.updated++; else result.added++;
    }
  })();
  return result;
}

/** Rebuild the upcoming occurrences from everything stored. Cheap; runs after each check and hourly. */
export async function rebuildInviteEvents() {
  const rows = db.prepare('SELECT * FROM invites').all();
  const cancelledSeries = new Set(rows.filter(r => !r.recurrence_id && r.cancelled).map(r => r.uid));
  const hasMaster = new Set(rows.filter(r => !r.recurrence_id).map(r => r.uid));
  const tz = new Map();
  const comps = [];
  for (const r of rows) {
    if (cancelledSeries.has(r.uid)) continue;
    for (const t of blocks(r.timezones, 'VTIMEZONE')) { const id = prop(t, 'TZID')?.value; if (id && !tz.has(id)) tz.set(id, t); }
    // One changed occurrence of a series we never received: show it as a stand-alone meeting.
    let c = r.component;
    if (r.recurrence_id && !hasMaster.has(r.uid)) c = stripProps(c, ['RECURRENCE-ID']).replace(/^UID:(.*)$/m, (_, u) => `UID:${u}#${r.recurrence_id.replace(/[^0-9TZ]/g, '')}`);
    comps.push(c);
  }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Heartwood//Invites//EN', ...tz.values(), ...comps, 'END:VCALENDAR'].join('\r\n');
  const c = inviteConfig();
  const exclude = [c.user.toLowerCase()].filter(Boolean);
  const events = comps.length ? await parseEvents(ics, { exclude }) : [];
  db.transaction(() => {
    db.prepare('DELETE FROM invite_events').run();
    const ins = db.prepare(`INSERT OR REPLACE INTO invite_events(key, uid, title, start, end, all_day, location, attendees) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of events) ins.run(e.key, e.uid, e.title, e.start, e.end, e.all_day ? 1 : 0, e.location, JSON.stringify(e.attendees));
  })();
  return events.length;
}

// ---------- sender checks ----------
export function senderAllowed(from, allowed) {
  const f = String(from || '').toLowerCase();
  if (!f || !allowed.length) return false;
  return allowed.some(a => (a.startsWith('@') ? f.endsWith(a) : f === a));
}

/** Reject mail the receiving server says failed authentication (spoofed From). */
export function authFailed(headerValue) {
  const h = String(Array.isArray(headerValue) ? headerValue.join(' ') : headerValue || '').toLowerCase();
  if (!h) return false; // the server didn't add results; fall back to the allow-list alone
  if (/dmarc=fail/.test(h)) return true;
  return /spf=fail/.test(h) && !/dkim=pass/.test(h);
}

// ---------- the mailbox ----------
// Every email in the inbox is looked at once and remembered by its Message-ID. Emails skipped because
// the sender wasn't allowed are looked at again on later checks, so fixing INVITE_ALLOWED_FROM picks
// them up without resending. Read/unread doesn't matter, so opening the mailbox in webmail is fine.
db.exec(`CREATE TABLE IF NOT EXISTS invite_mail (
  message_id TEXT PRIMARY KEY,
  sender TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,             -- applied | no_invite | not_allowed | failed_auth | error
  seen_at TEXT NOT NULL
)`);

export async function checkInbox() {
  const c = inviteConfig();
  if (!configured(c) || state.checking) return status();
  state.checking = true;
  const result = { messages: 0, added: 0, updated: 0, cancelled: 0, ignored: 0 };
  let client;
  try {
    if (!c.allowed.length) throw new Error('Add your work address under Allowed senders so Heartwood knows whose invites to read.');
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');
    // Never sign in to the mailbox in the clear: port 993 is TLS from the start; anything else must upgrade with STARTTLS.
    client = new ImapFlow({ host: c.host, port: c.port, secure: c.port === 993, ...(c.port === 993 ? {} : { doSTARTTLS: true }), auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60000 });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const known = db.prepare('SELECT outcome, sender FROM invite_mail WHERE message_id = ?');
      const remember = db.prepare(`INSERT INTO invite_mail(message_id, sender, outcome, seen_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET sender = excluded.sender, outcome = excluded.outcome, seen_at = excluded.seen_at`);
      // 1) Cheap pass: envelopes only, to decide which emails need reading.
      const todo = [];
      if (client.mailbox.exists > 0) {
        for await (const msg of client.fetch('1:*', { uid: true, envelope: true })) {
          const id = msg.envelope?.messageId || `uid:${msg.uid}`;
          const sender = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const k = known.get(id);
          if (!k || (k.outcome === 'not_allowed' && senderAllowed(sender, c.allowed)) || k.outcome === 'error') todo.push({ uid: msg.uid, id });
        }
      }
      // 2) Read the ones that matter.
      for (const { uid, id } of todo) {
        result.messages++;
        let sender = '';
        try {
          const msg = await client.fetchOne(String(uid), { source: { maxLength: 8 * 1024 * 1024 } }, { uid: true });
          const mail = await simpleParser(msg.source);
          sender = (mail.from?.value?.[0]?.address || '').toLowerCase();
          if (!senderAllowed(sender, c.allowed)) { result.ignored++; remember.run(id, sender, 'not_allowed', now()); continue; }
          if (authFailed(mail.headers.get('authentication-results'))) { result.ignored++; remember.run(id, sender, 'failed_auth', now()); continue; }
          const parts = (mail.attachments || []).filter(a => /text\/calendar/i.test(a.contentType) || /\.ics$/i.test(a.filename || ''));
          if (!parts.length) { result.ignored++; remember.run(id, sender, 'no_invite', now()); continue; }
          for (const p of parts) {
            const r = applyCalendar(p.content.toString('utf8'));
            for (const k of ['added', 'updated', 'cancelled', 'ignored']) result[k] += r[k] || 0;
          }
          remember.run(id, sender, 'applied', now());
        } catch (err) { console.error('[invites] message', err.message); result.ignored++; remember.run(id, sender, 'error', now()); }
      }
      // Keep the mailbox small: invites carry agendas and join links we don't need to hold onto.
      const old = await client.search({ before: new Date(Date.now() - KEEP_MAIL_DAYS * 864e5) }, { uid: true });
      if (old?.length) await client.messageDelete(old, { uid: true });
      db.prepare('DELETE FROM invite_mail WHERE seen_at < ?').run(new Date(Date.now() - 30 * 864e5).toISOString());
    } finally { lock.release(); }
    await client.logout();
    await rebuildInviteEvents();
    state.error = null;
    state.lastResult = result;
  } catch (err) {
    state.error = /auth|login|credential/i.test(err.message) ? 'Couldn’t sign in to the mailbox. Check the address and password in Settings → Meetings & calendar.' : err.message;
    console.error('[invites]', err.message);
    try { await client?.logout(); } catch { /* already closed */ }
  } finally {
    state.checking = false;
    state.lastCheck = new Date().toISOString();
  }
  return status();
}

export function status() {
  const c = inviteConfig();
  const meetings = db.prepare(`SELECT uid, MAX(title) AS title, MAX(received_at) AS received_at, MIN(CASE WHEN recurrence_id = '' THEN cancelled END) AS cancelled
    FROM invites GROUP BY uid ORDER BY received_at DESC LIMIT 50`).all();
  const nextQ = db.prepare('SELECT MIN(start) AS s FROM invite_events WHERE uid = ? AND start >= ?');
  const nowIso = new Date().toISOString();
  return {
    configured: configured(c),
    address: c.user || null,
    allowed: c.allowed,
    allowed_env: envAllowed(),
    last_check: state.lastCheck,
    checking: state.checking,
    error: state.error,
    last_result: state.lastResult,
    // Why recent emails were skipped, so a wrong INVITE_ALLOWED_FROM is easy to spot.
    skipped: db.prepare(`SELECT sender, outcome, COUNT(*) AS n FROM invite_mail WHERE outcome IN ('not_allowed', 'failed_auth', 'no_invite', 'error')
      GROUP BY sender, outcome ORDER BY MAX(seen_at) DESC LIMIT 10`).all(),
    meetings: meetings.map(m => ({ uid: m.uid, title: cleanTitle(m.title), received_at: m.received_at, cancelled: !!m.cancelled, next: nextQ.get(m.uid, nowIso)?.s || null }))
  };
}

export async function forgetInvite(uid) {
  db.prepare('DELETE FROM invites WHERE uid = ?').run(uid);
  await rebuildInviteEvents();
}

export function startInviteChecks() {
  // Checks start on their own once the mailbox is set up, in Settings or .env.
  const run = () => (configured(inviteConfig()) ? checkInbox() : null);
  if (!configured(inviteConfig())) rebuildInviteEvents().catch(() => {});
  run();
  setInterval(run, POLL_MIN * 60e3).unref();
  setInterval(() => rebuildInviteEvents().catch(e => console.error('[invites]', e.message)), 60 * 60e3).unref(); // window moves forward
}
export const _test = { unfold, prop, blocks, stripProps, recurrenceKey };
