import express from 'express';
import { db, newId, now, getSettings, listPeople } from '../db.js';
import { getAttachments } from '../ask.js';
import { listFollowups, findSource, tidyPlan, tidyApply, restoreFollowups, bulkFollowups, oldOpenCount, letGo } from '../followups.js';
import { goodMoment } from '../moments.js';
import { addContext } from '../context.js';
import { local, startOfLocalDay } from '../localtime.js';
import { calendarStatus, connectCalendar, disconnectCalendar, syncCalendar, upcomingEvents, meetingDetail, setMeetingPeople, linkAttendee, meetingSeries } from '../calendar.js';
import { complete } from '../llm.js';
import { agenda, makePrep } from '../agenda.js';
import { endOfDayDue, startEndOfDay } from '../notify.js';
import { todaysPractice, swapPractice, markPractice } from '../practices.js';
import { growthRings } from '../growth.js';
import { teamWeek, saveRead, clearTodayRead, readsFor, dismissNeeds } from '../team.js';
import { STYLES } from '../leadership.js';
import { templateList, suggestTemplate, findAgenda, getAgenda, buildAgenda, updateAgenda, deleteAgenda, shareText, startNotes } from '../oneonone.js';
import { publicKey, saveSubscription, removeSubscription, sendAll, morningSummary, weeklyDebrief, notificationStatus, saveNotificationSettings } from '../notify.js';
import { listSchedules, parseKey } from '../schedules.js';
import { status as inviteStatus, checkInbox, forgetInvite, allowSender, disallowSender } from '../invites.js';

export const today = express.Router();

// Extras on Today shouldn't be able to take the whole screen down.
const safely = fn => { try { return fn(); } catch (err) { console.error('[today]', err.message); return null; } };

// ---------- the Today screen ----------
today.get('/today', (req, res) => {
  const people = listPeople();
  const events = agenda({ days: 7 });
  const open = listFollowups({ status: 'open', limit: 3000 });
  // "Say hi to": up to three people you lead or work with closely whom you haven't written about in a
  // while, each with a reason to reach out (something you owe them, or what you last talked about).
  const cutoff = Date.now() - 21 * 864e5;
  const lastNote = db.prepare(`SELECT e.title, e.created_at FROM entries e JOIN entry_people ep ON ep.entry_id = e.id WHERE ep.person_id = ? ORDER BY e.created_at DESC LIMIT 1`);
  const checkIns = people
    .filter(p => ['direct_report', ''].includes(p.relationship || '') && (!p.last_entry_at || Date.parse(p.last_entry_at) < cutoff))
    .sort((a, b) => (a.last_entry_at || '').localeCompare(b.last_entry_at || ''))
    .slice(0, 3)
    .map(p => {
      const owed = open.find(f => f.mine && f.person_id === p.id);
      const last = lastNote.get(p.id);
      const reason = owed ? `On your list for them: ${owed.text}`
        : last?.title ? `Last time: ${last.title}` : 'No notes yet. A quick hello is a good start.';
      return { id: p.id, name: p.name, photo: p.photo, role: p.role, last_entry_at: p.last_entry_at, reason: reason.slice(0, 140) };
    });
  // Make the list feel smaller: older follow-ups that aren't pressing wait in Someday.
  const someday = f => {
    const age = Date.now() - Date.parse(f.entry_date || f.created_at || 0);
    return age > 30 * 864e5 && f.priority !== 'high' && !f.reasons?.some(r => r.urgent);
  };
  const dayStart = startOfLocalDay(local().ymd).toISOString();
  const doneToday = db.prepare('SELECT COUNT(*) AS n FROM followups WHERE (done_at >= ? OR let_go_at >= ?)').get(dayStart, dayStart).n;
  const eod = endOfDayDue();
  const practice = safely(todaysPractice);
  const moment = safely(goodMoment);
  const lastDebrief = db.prepare(`SELECT id, title, range_from, range_to, focus, created_at FROM reports WHERE kind = 'period' ORDER BY created_at DESC LIMIT 1`).get() || null;
  res.json({
    calendar: calendarStatus(),
    invites: { configured: inviteStatus().configured, address: inviteStatus().address },
    has_schedules: !!db.prepare('SELECT 1 FROM schedules WHERE active = 1 LIMIT 1').get(),
    events,
    followups: {
      mine: open.filter(f => f.mine && !someday(f)), theirs: open.filter(f => !f.mine && !someday(f)),
      someday_mine: open.filter(f => f.mine && someday(f)), someday_theirs: open.filter(f => !f.mine && someday(f)),
      done_today: doneToday
    },
    followups_old: oldOpenCount(90),
    check_ins: checkIns,
    last_debrief: lastDebrief,
    end_of_day: eod,
    practice,
    moment,
    top: topPick({ practice, moment, events, eod }),
    rings: safely(growthRings),
    coverage: safely(() => teamWeek({ agendaFn: agenda })),
    has_entries: !!db.prepare('SELECT 1 FROM entries LIMIT 1').get()
  });
});

/**
 * The top card shows one thing, picked for the moment you're in:
 *   practice  while it can still help today: a workday with conversations still ahead, or a full day
 *   moment    once the day is winding down, after you've tried the practice, on weekends, or when
 *             there's a teammate's win waiting to be recognized
 *   quote     when neither fits (or there's nothing else yet)
 * "Something else" on the card shows the others.
 */
function topPick({ practice, moment, events, eod }) {
  const { ymd, hm } = local();
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const workday = weekday >= 1 && weekday <= 5;
  const today = events.filter(e => e.people.length && e.status !== 'skipped' && !e.all_day && local(new Date(e.start)).ymd === ymd);
  const ahead = today.filter(e => Date.parse(e.start) > Date.now() - 15 * 60e3);
  const evening = hm >= (getSettings().notifications?.evening_time || '17:30') || !!eod?.entry_id;
  const untried = practice && !practice.done_at;
  if (untried && workday && !evening && (ahead.length || today.length >= 4 || hm < '12:00')) return 'practice';
  if (moment && (moment.kind === 'kudos' || evening || !workday || practice?.done_at)) return 'moment';
  if (untried && workday && !evening) return 'practice';
  if (moment) return 'moment';
  return practice?.quote ? 'quote' : practice ? 'practice' : null;
}

// ---------- your team this week: how they seemed (your read), and dismissing "might need you" ----------
today.post('/team/:id/read', (req, res) => {
  try { res.json(saveRead({ personId: req.params.id, read: req.body?.read, note: req.body?.note || '', entryId: req.body?.entry_id || null })); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
today.delete('/team/:id/read', (req, res) => res.json(clearTodayRead(req.params.id)));
today.get('/team/week', (req, res) => res.json(teamWeek({ agendaFn: agenda })));
today.get('/team/:id/reads', (req, res) => res.json(readsFor(req.params.id)));
today.post('/team/:id/dismiss', (req, res) => { dismissNeeds(req.params.id); res.json({ ok: true }); });

// "Something to try": another one for today, or mark it tried.
today.post('/practice/another', (req, res) => res.json(swapPractice()));
today.post('/practice/done', (req, res) => res.json(markPractice(req.body?.done !== false)));

// Leadership styles you can choose in Settings → About you.
today.get('/leadership/styles', (req, res) => res.json(Object.entries(STYLES).map(([key, s]) => ({ key, label: s.label, short: s.short }))));

// ---------- 1:1 agenda builder ----------
today.get('/agenda-templates', (req, res) => res.json({ templates: templateList(), suggested: req.query.person ? suggestTemplate(String(req.query.person)) : 'regular' }));
today.get('/agendas', (req, res) => {
  const a = findAgenda({ personId: req.query.person ? String(req.query.person) : null, eventKey: req.query.event_key ? String(req.query.event_key) : null });
  res.json(a ? { ...a, share_text: shareText(a) } : null);
});
today.post('/agendas', async (req, res, next) => {
  try {
    const b = req.body || {};
    const a = await buildAgenda({ personId: b.person_id, eventKey: b.event_key || null, template: b.template, title: b.title, suggest: b.suggest !== false });
    res.status(201).json({ ...a, share_text: shareText(a) });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
today.patch('/agendas/:id', (req, res) => {
  const a = updateAgenda(req.params.id, req.body || {});
  return a ? res.json({ ...a, share_text: shareText(a) }) : res.status(404).json({ error: 'Not found' });
});
today.delete('/agendas/:id', (req, res) => { deleteAgenda(req.params.id); res.json({ ok: true }); });
today.post('/agendas/:id/notes', (req, res) => {
  const id = startNotes(req.params.id);
  return id ? res.status(201).json({ entry_id: id }) : res.status(404).json({ error: 'Not found' });
});
today.get('/agendas/:id', (req, res) => { const a = getAgenda(req.params.id); return a ? res.json({ ...a, share_text: shareText(a) }) : res.status(404).json({ error: 'Not found' }); });

// End-of-day reflection: start today's note (or reopen it).
today.post('/reflections/end-of-day', (req, res) => res.status(201).json({ id: startEndOfDay() }));

// ---------- follow-ups ----------
today.get('/followups', (req, res) => {
  const status = ['done', 'archived'].includes(req.query.status) ? req.query.status : 'open';
  res.json(listFollowups({ status, personId: req.query.person || null, limit: status === 'archived' ? 500 : 200 }));
});

// Tidy up: preview (GET) and apply (POST) archiving follow-ups from notes older than `days`.
const tidyDays = v => [30, 60, 90, 180, 365].includes(Number(v)) ? Number(v) : 90;
today.get('/followups/tidy', (req, res) => {
  const p = tidyPlan({ days: tidyDays(req.query.days) });
  res.json({ days: p.days, cutoff: p.cutoff, archive_count: p.archive.length, keep: p.keep.slice(0, 50), keep_count: p.keep.length,
    sample: p.archive.slice(-5).reverse().map(f => ({ id: f.id, text: f.text, dated: f.dated, person_name: f.person_name })) });
});
today.post('/followups/tidy', (req, res) => res.json(tidyApply({ days: tidyDays(req.body?.days) })));
today.post('/followups/restore', (req, res) => res.json({ restored: restoreFollowups({ batch: req.body?.batch, ids: req.body?.ids }) }));
// Respond to follow-ups: explain what's happening in your own words; Heartwood proposes which open
// follow-ups that settles (done / no longer relevant / reworded). Nothing changes until you apply.
const RESPOND_SYSTEM = `You help a people manager keep their follow-up list accurate.
You get the manager's update, in their own words, and a list of their OPEN follow-ups (commitments they or others made).
Decide which follow-ups the update settles:
- "done": the update says it happened or was completed.
- "dismiss": the update makes it moot, cancelled or no longer relevant.
- "update": still open, but the update changes what's left; give a short new wording (under 20 words, same voice as the original).
Leave everything else out. Only act when the update clearly covers a follow-up; when in doubt, leave it out.
Return JSON only: {"changes":[{"id":"<id from the list>","action":"done"|"dismiss"|"update","text":"<new wording, update only>","why":"<under 12 words, quoting or paraphrasing the update>"}]}`;

const kw = t => [...new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 5))];

today.post('/followups/respond', async (req, res, next) => {
  try {
    const files = getAttachments((Array.isArray(req.body?.attachments) ? req.body.attachments : []).map(String).slice(0, 8));
    const text = String(req.body?.text || '').trim() || (files.length ? 'See the attached files.' : '');
    if (!text) return res.status(400).json({ error: 'Write what’s happening first.' });
    const open = listFollowups({ status: 'open', limit: 3000 });
    const focus = req.body.followup_id ? open.find(f => f.id === req.body.followup_id) : null;
    const personId = req.body.person_id || focus?.person_id || null;
    const words = kw(`${text} ${focus?.text || ''} ${files.map(a => a.text.slice(0, 2000)).join(' ')}`);
    const score = f => (f.id === focus?.id ? 100 : 0) + (personId && f.person_id === personId ? 10 : 0)
      + kw(f.text).filter(w => words.includes(w)).length * 3;
    // Most likely related first; with no person to anchor on, consider everything (newest first).
    const candidates = open.map(f => ({ f, s: score(f) })).filter(x => x.s > 0 || !personId)
      .sort((a, b) => b.s - a.s).slice(0, 150).map(x => x.f);
    if (!candidates.length) return res.json({ changes: [], candidate_count: 0 });
    const list = candidates.map(f => `- id:${f.id} | ${f.text}${f.owner ? ` | owner: ${f.owner}` : ''}${f.person_name ? ` | about: ${f.person_name}` : ''}${f.entry_date ? ` | from a note on ${f.entry_date.slice(0, 10)}` : ''}`).join('\n');
    const person = personId ? db.prepare('SELECT name FROM people WHERE id = ?').get(personId) : null;
    const user = [
      `Today is ${new Date().toISOString().slice(0, 10)}.${person ? ` The update is mainly about ${person.name}.` : ''}`,
      focus ? `They were responding to: "${focus.text}"` : '',
      '',
      'The manager\'s update:',
      '<update>',
      text.slice(0, 4000),
      ...files.map(a => `\n[Attached: ${a.name}${a.images.length ? ' (shown above)' : ''}]${a.text ? `\n${a.text.slice(0, 12000)}` : ''}`),
      '</update>',
      '',
      'Open follow-ups:',
      list
    ].join('\n');
    const images = files.flatMap(a => a.images).slice(0, 8);
    const out = await complete({ system: RESPOND_SYSTEM, messages: [{ role: 'user', content: user, ...(images.length ? { images } : {}) }], json: true, maxTokens: 4000 });
    const byId = Object.fromEntries(candidates.map(f => [f.id, f]));
    const changes = (Array.isArray(out?.changes) ? out.changes : [])
      .filter(c => byId[c.id] && ['done', 'dismiss', 'update'].includes(c.action) && (c.action !== 'update' || String(c.text || '').trim()))
      .map(c => ({
        id: c.id, action: c.action, text: c.action === 'update' ? String(c.text).trim().slice(0, 500) : undefined,
        why: String(c.why || '').slice(0, 200), original: byId[c.id].text, person_name: byId[c.id].person_name, mine: byId[c.id].mine
      }));
    res.json({ changes, candidate_count: candidates.length });
  } catch (err) { next(err); }
});

today.post('/followups/respond/apply', (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  const t = now();
  const done = db.prepare('UPDATE followups SET done_at = ? WHERE id = ? AND done_at IS NULL');
  const dismiss = db.prepare('UPDATE followups SET dismissed = 1 WHERE id = ?');
  const update = db.prepare('UPDATE followups SET text = ? WHERE id = ?');
  let n = 0, entryId = null, contextCount = 0;
  db.transaction(() => {
    for (const c of changes.slice(0, 500)) {
      if (c.action === 'done') n += done.run(t, c.id).changes;
      else if (c.action === 'dismiss') n += dismiss.run(c.id).changes;
      else if (c.action === 'update' && String(c.text || '').trim()) n += update.run(String(c.text).trim().slice(0, 500), c.id).changes;
    }
    // Keep your explanation, so the context isn't lost with the ticked-off items. Plain text goes on
    // the context thread of the people it's about (not your journal); with files, or when you ask for
    // it, it becomes a journal note.
    const note = req.body?.note;
    const files = getAttachments((Array.isArray(note?.attachments) ? note.attachments : []).map(String).slice(0, 8));
    const aboutIds = new Set(note?.person_id ? [note.person_id] : []);
    {
      const fq = db.prepare('SELECT person_id, entry_id FROM followups WHERE id = ?');
      const eq = db.prepare('SELECT person_id FROM entry_people WHERE entry_id = ?');
      for (const c of [...changes.slice(0, 500), ...(note?.followup_id ? [{ id: note.followup_id }] : [])]) {
        const f = fq.get(c.id);
        if (f?.person_id) aboutIds.add(f.person_id);
        else if (f?.entry_id) { const linked = eq.all(f.entry_id); if (linked.length === 1) aboutIds.add(linked[0].person_id); }
      }
    }
    if (note?.text?.trim() && !files.length && !note.to_journal && aboutIds.size) {
      for (const pid of [...aboutIds].slice(0, 20)) {
        if (db.prepare('SELECT 1 FROM people WHERE id = ?').get(pid)) addContext({ kind: 'person', id: pid, text: String(note.text).trim().slice(0, 4000), source: 'update' });
      }
      contextCount = aboutIds.size;
    } else if (note?.text?.trim() || files.length) {
      entryId = newId();
      db.prepare(`INSERT INTO entries(id, title, kind, body_md, tags, created_at, updated_at) VALUES (?, ?, 'note', ?, '["follow-ups"]', ?, ?)`)
        .run(entryId, String(note.title || 'Follow-up update').slice(0, 200), String(note.text || '').trim().slice(0, 20000) || 'Update with attached files.', t, t);
      // Files you added come along as the note's attachments, already read.
      const addFile = db.prepare(`INSERT INTO entry_files(id, entry_id, name, mime, size, kind, stored, extracted_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`);
      files.filter(a => a.stored).forEach((a, i) => addFile.run(newId(), entryId, a.name, a.mime || '', a.size, a.kind, a.stored, a.text, new Date(Date.now() + i).toISOString()));
      // Link the note to everyone it's about: the person you were updating, plus the people on the
      // follow-ups it settled (and on the notes those follow-ups came from).
      const ids = new Set(note.person_id ? [note.person_id] : []);
      const fq = db.prepare('SELECT person_id, entry_id FROM followups WHERE id = ?');
      const eq = db.prepare('SELECT person_id FROM entry_people WHERE entry_id = ?');
      for (const c of [...changes.slice(0, 500), ...(note.followup_id ? [{ id: note.followup_id }] : [])]) {
        const f = fq.get(c.id);
        if (f?.person_id) ids.add(f.person_id);
        else if (f?.entry_id) { const linked = eq.all(f.entry_id); if (linked.length === 1) ids.add(linked[0].person_id); }
      }
      const ins = db.prepare('INSERT OR IGNORE INTO entry_people(entry_id, person_id) SELECT ?, id FROM people WHERE id = ?');
      for (const id of [...ids].slice(0, 20)) ins.run(entryId, id);
    }
  })();
  res.json({ changed: n, entry_id: entryId, context: contextCount });
});

today.post('/followups/let-go', (req, res) => {
  try { res.json(letGo(Array.isArray(req.body?.ids) ? req.body.ids : [], req.body?.reason)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

today.post('/followups/bulk', (req, res) => {
  try { res.json(bulkFollowups(Array.isArray(req.body?.ids) ? req.body.ids : [], req.body?.action)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

today.post('/followups', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write the follow-up first.' });
  const id = newId();
  db.prepare(`INSERT INTO followups(id, entry_id, person_id, text, owner, due, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`)
    .run(id, req.body.entry_id || null, req.body.person_id || null, text.slice(0, 500), String(req.body.owner || 'me').slice(0, 100), String(req.body.due || '').slice(0, 100), now());
  res.status(201).json(listFollowups({ status: 'open' }).find(f => f.id === id));
});

today.patch('/followups/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM followups WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE followups SET text = ?, owner = ?, due = ?, person_id = ?, done_at = ?, dismissed = ? WHERE id = ?`).run(
    typeof b.text === 'string' && b.text.trim() ? b.text.trim().slice(0, 500) : f.text,
    typeof b.owner === 'string' ? b.owner.slice(0, 100) : f.owner,
    typeof b.due === 'string' ? b.due.slice(0, 100) : f.due,
    b.person_id !== undefined ? b.person_id || null : f.person_id,
    typeof b.done === 'boolean' ? (b.done ? now() : null) : f.done_at,
    typeof b.dismissed === 'boolean' ? (b.dismissed ? 1 : 0) : f.dismissed,
    f.id
  );
  res.json({ ok: true });
});

today.get('/followups/:id/source', (req, res) => {
  const src = findSource(req.params.id);
  return src ? res.json(src) : res.status(404).json({ error: 'Not found' });
});

today.delete('/followups/:id', (req, res) => {
  db.prepare('DELETE FROM followups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- prep for a conversation ----------
today.post('/prep', async (req, res, next) => {
  try { res.status(201).json(await makePrep({ personId: req.body?.person_id, eventKey: req.body?.event_key || null })); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

// ---------- phone notifications ----------
today.get('/push', async (req, res, next) => { try { res.json({ ...notificationStatus(), public_key: await publicKey() }); } catch (err) { next(err); } });
today.post('/push/subscribe', (req, res) => {
  try { saveSubscription(req.body?.subscription, req.get('user-agent')); res.json(notificationStatus()); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
today.post('/push/unsubscribe', (req, res) => { removeSubscription(String(req.body?.endpoint || '')); res.json(notificationStatus()); });
today.put('/push/settings', (req, res) => { saveNotificationSettings(req.body || {}); res.json(notificationStatus()); });
today.post('/push/test', async (req, res, next) => {
  try {
    if (req.body?.kind === 'weekly') { const w = await weeklyDebrief(); return res.json({ report_id: w.id }); }
    const r = req.body?.kind === 'morning' ? await morningSummary({ force: true })
      : { sent: await sendAll({ title: 'Heartwood', body: 'Notifications are on. You’ll hear from Heartwood here.', url: '/', tag: 'test' }) };
    res.json(r);
  } catch (err) {
    if (/No entries/.test(err.message)) return res.status(400).json({ error: 'No notes in the last 7 days yet.' });
    next(err);
  }
});

// ---------- calendar connection ----------
today.get('/calendar', (req, res) => res.json(calendarStatus()));
today.put('/calendar', async (req, res) => {
  try { res.json(await connectCalendar(req.body?.url)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
today.delete('/calendar', (req, res) => { disconnectCalendar(); res.json(calendarStatus()); });
today.post('/calendar/sync', async (req, res) => { await syncCalendar(); res.json(calendarStatus()); });

// ---------- who's in a meeting (calendar or invite), for the whole series ----------
// Upcoming calendar / invite meetings with one person, the next one per series.
today.get('/meetings', (req, res) => {
  const pid = req.query.person;
  const seen = new Set();
  const list = upcomingEvents({ people: listPeople(), myName: getSettings().profile?.name, days: 14 })
    .filter(e => (!pid || e.people.some(p => p.id === pid)) && !seen.has(e.uid) && seen.add(e.uid));
  res.json(list.map(e => ({ uid: e.uid, title: e.title, start: e.start, source: e.source })));
});

// Recurring meetings from invites and your calendar, for the Recurring page.
today.get('/meetings/series', (req, res) => {
  res.json(meetingSeries({ people: listPeople(), myName: getSettings().profile?.name }).filter(m => m.recurring && m.next));
});

today.get('/meetings/:uid', (req, res) => {
  const m = meetingDetail(req.params.uid, listPeople(), getSettings().profile?.name);
  return m ? res.json(m) : res.status(404).json({ error: 'Not found' });
});
today.put('/meetings/:uid/people', (req, res) => {
  const b = req.body || {};
  setMeetingPeople(req.params.uid, b.automatic ? null : Array.isArray(b.people) ? b.people : []);
  res.json(meetingDetail(req.params.uid, listPeople(), getSettings().profile?.name));
});
today.post('/meetings/:uid/attendee', (req, res) => {
  try {
    const r = linkAttendee(req.params.uid, req.body?.i, req.body?.person_id);
    res.json({ ...meetingDetail(req.params.uid, listPeople(), getSettings().profile?.name), ...r });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------- meeting invites sent to Heartwood's mailbox ----------
today.get('/invites', (req, res) => res.json(inviteStatus()));
today.post('/invites/check', async (req, res) => res.json(await checkInbox()));
// Allowed senders managed in the app (on top of INVITE_ALLOWED_FROM). Adding one re-checks the inbox,
// so emails skipped earlier from that sender are read right away.
today.post('/invites/allowed', async (req, res) => {
  try { allowSender(req.body?.sender); } catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(await checkInbox());
});
today.delete('/invites/allowed', (req, res) => { disallowSender(req.query.sender); res.json(inviteStatus()); });
today.delete('/invites/:uid', async (req, res) => { await forgetInvite(req.params.uid); res.json(inviteStatus()); });

// ---------- recurring conversations ----------
const FREQ = ['weekly', 'monthly', 'once'];
function cleanSchedule(b, prev = {}) {
  const people = Array.isArray(b.people) ? b.people.filter(id => db.prepare('SELECT 1 FROM people WHERE id = ?').get(id)) : safe(prev.people);
  const time = /^\d{1,2}:\d{2}$/.test(b.time || '') ? b.time.padStart(5, '0') : prev.time || '10:00';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(b.anchor_date || '') ? b.anchor_date : prev.anchor_date;
  let tz = b.tz || prev.tz || process.env.TZ || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/New_York'; }
  return {
    title: typeof b.title === 'string' ? b.title.trim().slice(0, 120) : prev.title || '',
    people,
    frequency: FREQ.includes(b.frequency) ? b.frequency : prev.frequency || 'weekly',
    interval_weeks: [1, 2, 3, 4, 6, 8].includes(Number(b.interval_weeks)) ? Number(b.interval_weeks) : prev.interval_weeks || 2,
    anchor_date: anchor,
    time,
    duration_min: Math.min(480, Math.max(5, Number(b.duration_min) || prev.duration_min || 30)),
    tz,
    active: typeof b.active === 'boolean' ? (b.active ? 1 : 0) : prev.active ?? 1
  };
}
const safe = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };

today.get('/schedules', (req, res) => {
  const all = listSchedules(listPeople());
  res.json(req.query.person ? all.filter(s => s.people.some(p => p.id === req.query.person)) : all);
});

today.post('/schedules', (req, res) => {
  const v = cleanSchedule(req.body || {});
  if (!v.people.length) return res.status(400).json({ error: 'Pick who it’s with.' });
  if (!v.anchor_date) return res.status(400).json({ error: 'Pick the date of the next one.' });
  const id = newId();
  db.prepare(`INSERT INTO schedules(id, title, people, frequency, interval_weeks, anchor_date, time, duration_min, tz, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.title, JSON.stringify(v.people), v.frequency, v.interval_weeks, v.anchor_date, v.time, v.duration_min, v.tz, v.active, now());
  res.status(201).json(listSchedules(listPeople()).find(s => s.id === id));
});

today.patch('/schedules/:id', (req, res) => {
  const prev = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Not found' });
  const v = cleanSchedule(req.body || {}, prev);
  if (!v.people.length) return res.status(400).json({ error: 'Pick who it’s with.' });
  db.prepare(`UPDATE schedules SET title = ?, people = ?, frequency = ?, interval_weeks = ?, anchor_date = ?, time = ?, duration_min = ?, tz = ?, active = ? WHERE id = ?`)
    .run(v.title, JSON.stringify(v.people), v.frequency, v.interval_weeks, v.anchor_date, v.time, v.duration_min, v.tz, v.active, prev.id);
  // A new cadence makes old per-date changes meaningless; keep only ones that still line up.
  if (req.body?.anchor_date || req.body?.interval_weeks || req.body?.frequency) {
    db.prepare(`DELETE FROM schedule_exceptions WHERE schedule_id = ? AND date < ?`).run(prev.id, new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  }
  res.json(listSchedules(listPeople()).find(s => s.id === prev.id));
});

today.delete('/schedules/:id', (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Move or cancel one occurrence: { key, action: 'skip' | 'move', new_start }. DELETE to undo.
today.post('/schedule-occurrence', (req, res) => {
  const k = parseKey(req.body?.key);
  if (!k || !db.prepare('SELECT 1 FROM schedules WHERE id = ?').get(k.id)) return res.status(404).json({ error: 'Not found' });
  const action = req.body.action === 'move' ? 'move' : 'skip';
  const start = action === 'move' ? new Date(req.body.new_start) : null;
  if (action === 'move' && isNaN(start)) return res.status(400).json({ error: 'Pick the new date and time.' });
  db.prepare(`INSERT INTO schedule_exceptions(schedule_id, date, action, new_start) VALUES (?, ?, ?, ?)
    ON CONFLICT(schedule_id, date) DO UPDATE SET action = excluded.action, new_start = excluded.new_start`)
    .run(k.id, k.date, action, start ? start.toISOString() : null);
  res.json({ ok: true });
});

today.delete('/schedule-occurrence', (req, res) => {
  const k = parseKey(req.query.key);
  if (k) db.prepare('DELETE FROM schedule_exceptions WHERE schedule_id = ? AND date = ?').run(k.id, k.date);
  res.json({ ok: true });
});
