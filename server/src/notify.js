// Phone notifications (Web Push), sent by your server straight to your home-screen app.
// - Morning summary on days you have conversations, with prep written ahead of time if you want.
// - Optional reminder a few minutes before each one.
// Notifications are end-to-end encrypted to your device; Apple/Google relay them without being able to read them.
import { practiceForDay } from './practices.js';
import { db, now, newId, getSettings, saveSettings } from './db.js';
import { agenda, makePrep } from './agenda.js';
import { createPeriodReport } from './briefs.js';
import { isPushEndpoint } from './netguard.js';
import { backupProblem } from './backups.js';

db.exec(`CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

let webpush = null;
async function wp() {
  if (webpush) return webpush;
  webpush = (await import('web-push')).default;
  let keys = null;
  try { keys = JSON.parse(db.prepare(`SELECT value FROM secrets WHERE key = 'vapid'`).get()?.value || 'null'); } catch { /* none */ }
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    db.prepare(`INSERT OR REPLACE INTO secrets(key, value) VALUES ('vapid', ?)`).run(JSON.stringify(keys));
  }
  const contact = process.env.PUSH_CONTACT || `https://${process.env.HEARTWOOD_DOMAIN || 'localhost'}`;
  webpush.setVapidDetails(contact.includes(':') ? contact : `mailto:${contact}`, keys.publicKey, keys.privateKey);
  webpush._publicKey = keys.publicKey;
  return webpush;
}

export async function publicKey() { return (await wp())._publicKey; }

export function saveSubscription(sub, userAgent = '') {
  if (!sub?.endpoint || !isPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('That subscription doesn’t look right.');
  db.prepare(`INSERT INTO push_subscriptions(endpoint, keys, user_agent, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, user_agent = excluded.user_agent`)
    .run(sub.endpoint, JSON.stringify(sub.keys), String(userAgent).slice(0, 300), now());
}
export function removeSubscription(endpoint) { db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint); }
export const subscriptionCount = () => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;

/** Send to every subscribed device. Drops subscriptions the push service says are gone. */
export async function sendAll(payload) {
  const w = await wp();
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  let sent = 0;
  for (const s of subs) {
    if (!isPushEndpoint(s.endpoint)) { removeSubscription(s.endpoint); continue; }
    try {
      await w.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint);
      else console.error('[push]', err.statusCode || '', err.message);
    }
  }
  return sent;
}

// ---------- schedule ----------
const tz = () => process.env.TZ || 'America/New_York';
function local(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const timeOf = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', ' ');
const firstNames = ev => ev.people.map(p => p.name.split(' ')[0]).join(' & ');
const mark = (k, v) => db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
const read = (k, d) => { try { return JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? 'null') ?? d; } catch { return d; } };

/** Today's conversations with people you know (not cancelled), in your server's time zone. */
function todays() {
  const today = local().ymd;
  return agenda({ days: 1 }).filter(e => e.people.length && e.status !== 'skipped' && !e.all_day && local(new Date(e.start)).ymd === today && Date.parse(e.start) > Date.now() - 30 * 60e3);
}

export async function morningSummary({ force = false } = {}) {
  const n = getSettings().notifications;
  const events = todays();
  if (!events.length && !force) return { sent: 0, events: 0 };
  if (n.auto_prep) {
    for (const ev of events) {
      if (ev.prep) continue;
      try { const r = await makePrep({ personId: ev.people[0].id, eventKey: ev.key, reuse: true }); ev.prep = { id: r.id }; }
      catch (err) { console.error('[push] prep', err.message); }
    }
  }
  const title = events.length ? `Today: ${events.length} conversation${events.length === 1 ? '' : 's'}` : 'Nothing on today';
  const body = !events.length ? 'No conversations with your people today.'
    : n.show_names
      ? `${events.slice(0, 4).map(e => `${timeOf(e.start)} ${firstNames(e)}`).join(' · ')}${events.length > 4 ? ` +${events.length - 4}` : ''}${n.auto_prep ? '. Prep is ready.' : '.'}`
      : `First at ${timeOf(events[0].start)}.${n.auto_prep ? ' Prep is ready.' : ''}`;
  const sent = await sendAll({ title, body, url: '/', tag: 'morning' });
  return { sent, events: events.length };
}

// ---------- end-of-day reflection ----------
/** Today's conversations with your people, including ones already over. */
export function dayConversations() {
  const today = local().ymd;
  const start = new Date(Date.now() - 20 * 3600e3);
  return agenda({ days: 1, from: start }).filter(e => e.people.length && e.status !== 'skipped' && !e.all_day && local(new Date(e.start)).ymd === today && Date.parse(e.start) <= Date.now());
}
/** Today's end-of-day note, if you've started one. */
export function endOfDayToday() {
  const today = local().ymd;
  return db.prepare(`SELECT id, created_at FROM entries WHERE (EXISTS (SELECT 1 FROM json_each(entries.tags) WHERE json_each.value = 'end-of-day') OR title LIKE 'End of day%') AND created_at >= ? ORDER BY created_at DESC`)
    .all(new Date(Date.now() - 36 * 3600e3).toISOString()).find(r => local(new Date(r.created_at)).ymd === today) || null;
}
/** Is it the end of a workday (and not reflected yet)? Shown as a card on Today. */
export function endOfDayDue() {
  const n = getSettings().notifications;
  const { ymd, hm } = local();
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const existing = endOfDayToday();
  return { due: !existing && weekday >= 1 && weekday <= 5 && hm >= (n.evening_time || '17:30') && hm < '23:59', entry_id: existing?.id || null, conversations: dayConversations().length };
}
const PROMPTS = ['What went well?', 'What took more energy than it should have?', 'How did I show up as a leader today?', 'Who needs something from me tomorrow?', 'One thing to carry into tomorrow'];
/** Start (or reopen) today's end-of-day note: today's conversations, then a few short prompts. */
export function startEndOfDay() {
  const existing = endOfDayToday();
  if (existing) return existing.id;
  const label = new Date().toLocaleDateString('en-US', { timeZone: tz(), weekday: 'short', month: 'short', day: 'numeric' });
  const convs = dayConversations();
  const list = convs.length ? `**Today’s conversations:** ${convs.map(e => `${timeOf(e.start)} ${e.title}`).join(' · ')}\n\n` : '';
  const tried = practiceForDay();
  const prompts = tried?.done_at ? [...PROMPTS.slice(0, 3), `Something to try: ${tried.title}. How did it go?`, ...PROMPTS.slice(3)] : PROMPTS;
  const body = `${list}${prompts.map(q => `### ${q}\n\n`).join('')}`.trim();
  const id = newId(), t = now();
  db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, created_at, updated_at) VALUES (?, ?, 'note', ?, '["end-of-day"]', ?, ?)`).run(id, `End of day · ${label}`, body, t, t);
  return id;
}

/** Write the weekly debrief for the last 7 days, and tell your phone. */
export async function weeklyDebrief({ notify = true } = {}) {
  const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
  const toYmd = local(to).ymd, fromYmd = local(from).ymd;
  const people = db.prepare(`SELECT p.name FROM people p WHERE p.relationship = 'direct_report' AND NOT EXISTS (
    SELECT 1 FROM entry_people ep JOIN entries e ON e.id = ep.entry_id WHERE ep.person_id = p.id AND e.created_at >= ?)`).all(from.toISOString()).map(r => r.name);
  const focus = 'Weekly debrief: the patterns across this week\'s conversations, who needs attention next week, and promises coming due.'
    + (people.length ? ` Direct reports with no notes this week: ${people.join(', ')}.` : '');
  const r = await createPeriodReport({ fromIso: from.toISOString(), toIso: to.toISOString(), from: fromYmd, to: toYmd, focus });
  if (notify) await sendAll({ title: 'Your week, debriefed', body: `${r.entry_count} note${r.entry_count === 1 ? '' : 's'} this week. Patterns, who needs you, and what’s coming due.`, url: `/insights/${r.id}`, tag: 'weekly' });
  return r;
}

/** Conversations that ended a few minutes ago with nothing written since they started. */
function justEnded(delayMin = 5) {
  const nowMs = Date.now();
  const noteSince = db.prepare(`SELECT 1 FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? AND e.created_at >= ? LIMIT 1`);
  return agenda({ days: 1 }).filter(e => {
    if (!e.people.length || e.status === 'skipped' || e.all_day) return false;
    const end = Date.parse(e.end || '') || Date.parse(e.start) + 30 * 60e3;
    const since = nowMs - end;
    if (since < delayMin * 60e3 || since > (delayMin + 90) * 60e3) return false;
    const from = new Date(Date.parse(e.start) - 15 * 60e3).toISOString();
    return !e.people.some(p => noteSince.get(p.id, from));
  });
}

async function tick() {
  const n = getSettings().notifications;
  const { ymd, hm } = local();
  // Backups failing: one heads-up a day, in the morning, even on days without conversations.
  const bp = backupProblem();
  if (bp && subscriptionCount() && hm >= n.morning_time && read('_backup_alert', '') !== ymd) {
    mark('_backup_alert', ymd);
    await sendAll({ title: 'Heartwood backups', body: bp, url: '/settings/data', tag: 'backup' }).catch(err => console.error('[push] backup', err.message));
  }
  // Weekly debrief: written even with no phone subscribed (it shows on Today), once on the chosen day.
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  if (n.weekly && weekday === Number(n.weekly_day) && hm >= n.weekly_time && read('_weekly_sent', '') !== ymd) {
    mark('_weekly_sent', ymd);
    await weeklyDebrief({ notify: subscriptionCount() > 0 }).catch(err => console.error('[weekly]', err.message));
  }
  if (!subscriptionCount()) return;
  // Morning summary: once a day, at (or within two hours after) the chosen time.
  if (n.morning && read('_morning_sent', '') !== ymd && hm >= n.morning_time) {
    const [h, m] = n.morning_time.split(':').map(Number);
    const [ch, cm] = hm.split(':').map(Number);
    mark('_morning_sent', ymd);
    if ((ch * 60 + cm) - (h * 60 + m) <= 120) await morningSummary().catch(err => console.error('[push] morning', err.message));
  }
  // End of day, on weekdays: a nudge to reflect, unless you already have.
  if (n.evening && read('_evening_sent', '') !== ymd && hm >= n.evening_time && weekday >= 1 && weekday <= 5) {
    const [h, m] = n.evening_time.split(':').map(Number);
    const [ch, cm] = hm.split(':').map(Number);
    mark('_evening_sent', ymd);
    if ((ch * 60 + cm) - (h * 60 + m) <= 120 && !endOfDayToday()) {
      const met = dayConversations().length;
      await sendAll({
        title: 'End of day',
        body: met ? `${met} conversation${met === 1 ? '' : 's'} today. Two minutes: what went well, what to carry into tomorrow?` : 'Two minutes: what went well, and what do you want to carry into tomorrow?',
        url: '/?reflect=day', tag: 'evening'
      }).catch(err => console.error('[push] evening', err.message));
    }
  }
  // Heads-up before each conversation.
  if (n.before) {
    const sentKeys = new Set(read('_before_sent', []));
    const soon = todays().filter(e => { const dt = Date.parse(e.start) - Date.now(); return dt > 0 && dt <= n.before_min * 60e3 && !sentKeys.has(e.key); });
    for (const e of soon) {
      sentKeys.add(e.key);
      const mins = Math.max(1, Math.round((Date.parse(e.start) - Date.now()) / 60e3));
      await sendAll({
        title: n.show_names ? `${firstNames(e)} in ${mins} min` : `Conversation in ${mins} min`,
        body: e.prep ? 'Your prep is ready. Tap to open it.' : 'Tap to prep.',
        url: `/?prep=${encodeURIComponent(e.key)}`, tag: `before-${e.key}`
      }).catch(err => console.error('[push] before', err.message));
    }
    mark('_before_sent', [...sentKeys].slice(-200));
  }
  // Right after a conversation: nudge to capture it while it's fresh (skipped if you already wrote something).
  if (n.after) {
    const sentKeys = new Set(read('_after_sent', []));
    for (const e of justEnded(5).filter(x => !sentKeys.has(x.key))) {
      sentKeys.add(e.key);
      const ids = e.people.map(p => p.id).join(',');
      const title = `After: ${e.title}`.slice(0, 120);
      await sendAll({
        title: n.show_names ? `How did it go with ${firstNames(e)}?` : 'How did it go?',
        body: 'Tap to record a quick note while it’s fresh.',
        url: `/record?kind=memo&person=${encodeURIComponent(ids)}&title=${encodeURIComponent(title)}`, tag: `after-${e.key}`
      }).catch(err => console.error('[push] after', err.message));
    }
    mark('_after_sent', [...sentKeys].slice(-200));
  }
}

export function startNotifications() {
  setInterval(() => tick().catch(err => console.error('[push]', err.message)), 60e3).unref();
}

export function notificationStatus() {
  return { devices: subscriptionCount(), settings: getSettings().notifications, tz: tz() };
}

export function saveNotificationSettings(b = {}) {
  const cur = getSettings().notifications;
  const time = /^\d{2}:\d{2}$/.test(b.morning_time || '') ? b.morning_time : cur.morning_time;
  return saveSettings({
    notifications: {
      morning: typeof b.morning === 'boolean' ? b.morning : cur.morning,
      morning_time: time,
      auto_prep: typeof b.auto_prep === 'boolean' ? b.auto_prep : cur.auto_prep,
      before: typeof b.before === 'boolean' ? b.before : cur.before,
      before_min: [5, 10, 15, 30].includes(Number(b.before_min)) ? Number(b.before_min) : cur.before_min,
      after: typeof b.after === 'boolean' ? b.after : cur.after,
      weekly: typeof b.weekly === 'boolean' ? b.weekly : cur.weekly,
      weekly_day: [0, 1, 2, 3, 4, 5, 6].includes(Number(b.weekly_day)) ? Number(b.weekly_day) : cur.weekly_day,
      weekly_time: /^\d{2}:\d{2}$/.test(b.weekly_time || '') ? b.weekly_time : cur.weekly_time,
      evening: typeof b.evening === 'boolean' ? b.evening : cur.evening,
      evening_time: /^\d{2}:\d{2}$/.test(b.evening_time || '') ? b.evening_time : cur.evening_time,
      show_names: typeof b.show_names === 'boolean' ? b.show_names : cur.show_names
    }
  }).notifications;
}
