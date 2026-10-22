import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { FollowupItem, AddFollowup, PrepSheet, TidySheet, RespondSheet } from '../components/Followups.jsx';
import { formatDate } from '../lib/format.js';
import { OccurrenceSheet, theirTimes } from '../components/Occurrence.jsx';
import { MeetingSheet } from '../components/MeetingSheet.jsx';
import { useApp } from '../lib/context.js';
import { PracticeCard, WeekCard } from '../components/TodayExtras.jsx';
import Sheet from '../components/Sheet.jsx';
import { QuickAddSheet } from '../components/QuickAdd.jsx';

const eodTitle = () => `End of day · ${new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
const eodRecord = () => `/record?kind=memo&guide=day&title=${encodeURIComponent(eodTitle())}`;

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const dayLabel = iso => {
  const d = new Date(iso), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === tm.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};
const timeLabel = ev => (ev.all_day ? 'All day' : new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

export default function Today() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('mine');
  const [shown, setShown] = useState(3);
  const [showSomeday, setShowSomeday] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [prep, setPrep] = useState(null); // { person, event, existingId }
  const [done, setDone] = useState(null);
  const [archived, setArchived] = useState(null);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [lastTidy, setLastTidy] = useState(null); // { archived, batch } for Undo
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [occ, setOcc] = useState(null);
  const [meeting, setMeeting] = useState(null); // a calendar/invite event

  const [params, setParams] = useSearchParams();
  const load = useCallback(() => api.get('/today').then(setData).catch(e => notify(e.message)), [notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  async function showDone() {
    setDone(done ? null : await api.get('/followups?status=done'));
  }
  async function showArchived() {
    setArchived(archived ? null : await api.get('/followups?status=archived'));
  }
  const pick = id => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  function stopSelecting() { setSelecting(false); setPicked(new Set()); }
  async function bulk(action) {
    if (!picked.size) return;
    // Include the repeats folded into each picked item.
    const ids = list.filter(f => picked.has(f.id)).flatMap(f => [f.id, ...(f.also || [])]);
    await api.post('/followups/bulk', { ids, action });
    notify(`${action === 'done' ? 'Marked done' : 'Archived'}: ${ids.length}`);
    stopSelecting(); load();
    if (archived) api.get('/followups?status=archived').then(setArchived);
  }
  async function undoTidy() {
    await api.post('/followups/restore', { batch: lastTidy.batch });
    setLastTidy(null); load(); setArchived(null);
  }

  // End of day: start (or reopen) today's reflection note. Opened from the evening notification too.
  async function reflectOnDay() {
    try { const r = await api.post('/reflections/end-of-day'); nav(`/entry/${r.id}`); }
    catch (e) { notify(e.message); }
  }
  // From the notification: ask how you'd like to reflect (write or say it). "write" goes straight to the note.
  const [eodChoice, setEodChoice] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const r = params.get('reflect');
    if (r !== 'day' && r !== 'write') return;
    setParams({}, { replace: true });
    if (r === 'write') reflectOnDay(); else setEodChoice(true);
  }, [params]);
  const [eodHidden, setEodHidden] = useState(() => { try { return localStorage.getItem('hw:eod-hidden') === new Date().toDateString(); } catch { return false; } });

  // Opened from a link to a meeting (in Ask): /?meeting=<series uid>
  useEffect(() => {
    const uid = params.get('meeting');
    if (!uid || !data) return;
    setMeeting(data.events.find(e => e.uid === uid) || { uid });
    setParams({}, { replace: true });
  }, [params, data, setParams]);

  // Opened from a "starting soon" notification: /?prep=<event key>
  useEffect(() => {
    const key = params.get('prep');
    if (!key || !data) return;
    const ev = data.events.find(e => e.key === key);
    if (ev?.people.length) setPrep({ person: ev.people[0], event: ev, existingId: ev.prep?.id });
    setParams({}, { replace: true });
  }, [params, data, setParams]);

  if (!data) return <main className="page" />;
  const { calendar, events, followups, check_ins: checkIns } = data;

  // Group upcoming events by day; show today + next few days.
  const byDay = [];
  for (const ev of events.filter(e => showAll || e.people.length)) {
    const k = dayLabel(ev.start);
    if (byDay.at(-1)?.k !== k) byDay.push({ k, items: [] });
    byDay.at(-1).items.push(ev);
  }
  const list = tab === 'mine' ? followups.mine : followups.theirs;
  const later = (tab === 'mine' ? followups.someday_mine : followups.someday_theirs) || [];
  const doneToday = followups.done_today || 0;
  const hiddenEvents = events.filter(e => !e.people.length).length;
  const hasSource = calendar.connected || data.has_schedules || data.invites?.configured;
  const openPrep = ev => setPrep({ person: ev.people[0], event: ev, existingId: ev.prep?.id });

  return (
    <main className="page">
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="small muted">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="today-head">{greeting()}</h1>
        </div>
      </div>

      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => load()} />

      <Sheet open={eodChoice} onClose={() => setEodChoice(false)} title="End of day">
        <p className="muted" style={{ marginTop: 0 }}>Two minutes: what went well, how you showed up, what to carry into tomorrow.</p>
        <div className="stack">
          <button className="btn primary block" onClick={() => { setEodChoice(false); reflectOnDay(); }}><Icon name="note" size={18} /> {data.end_of_day?.entry_id ? 'Open your note' : 'Write it'}</button>
          <Link className="btn rec block" to={eodRecord()} onClick={() => setEodChoice(false)}><Icon name="mic" size={18} /> Say it out loud</Link>
          <button className="btn ghost block" onClick={() => setEodChoice(false)}>Not now</button>
        </div>
      </Sheet>

      {data.end_of_day?.due && !eodHidden && (
        <div className="card eod-card">
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <span className="eod-ic" aria-hidden="true"><Icon name="journal" size={18} /></span>
            <div className="grow">
              <h2 style={{ margin: 0, fontSize: 17 }}>End of day</h2>
              <p className="small muted" style={{ margin: '2px 0 10px' }}>{data.end_of_day.conversations ? `${data.end_of_day.conversations} conversation${data.end_of_day.conversations === 1 ? '' : 's'} today. ` : ''}Two minutes: what went well, how you showed up, what to carry into tomorrow.</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn small primary" onClick={reflectOnDay}><Icon name="note" size={16} /> Reflect</button>
                <Link className="btn small" to={eodRecord()}><Icon name="mic" size={16} /> Say it</Link>
                <button className="btn small ghost" onClick={() => { setEodHidden(true); try { localStorage.setItem('hw:eod-hidden', new Date().toDateString()); } catch { /* storage blocked */ } }}>Not today</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(data.practice || data.moment) && <PracticeCard key={data.practice?.day || 'm'} practice={data.practice} moment={data.moment} top={data.top} notify={notify} onChange={load} />}
      {data.has_entries && <WeekCard rings={data.rings} coverage={data.coverage} onChanged={load} />}

      {/* ---------- Coming up ---------- */}
      <div className="section-head"><Icon name="calendar" size={20} /><h2>Coming up</h2>
        {hiddenEvents > 0 && <button className="btn ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? 'With your people' : `All events (${events.length})`}</button>}
        {hasSource && <Link className="btn ghost small" to="/schedule">Recurring</Link>}
      </div>
      {!hasSource ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>Add your regular 1:1s and check-ins to see what’s coming up and get prepped before each one.</p>
          <Link className="btn primary small" to="/schedule?new=1"><Icon name="repeat" size={16} /> Add your recurring 1:1s</Link>
          <p className="small muted" style={{ marginBottom: 0 }}>Or <Link to="/settings/meetings" state={{ from: 'here' }}>invite Heartwood to your meetings</Link>, or <Link to="/settings/meetings" state={{ from: 'here' }}>connect a calendar</Link> with a private, read-only ICS link if your organization allows it.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: '6px 16px' }}>
          {calendar.error && <div className="banner error" role="alert" style={{ margin: '10px 0' }}>Calendar: {calendar.error}</div>}
          {!byDay.length && <p className="muted small">{events.length ? 'Nothing with people in your journal this week.' : 'Nothing coming up this week.'}</p>}
          {byDay.map(g => (
            <div key={g.k}>
              <div className="day-label" style={{ margin: '12px 0 2px' }}>{g.k}</div>
              {g.items.map(ev => {
                const sched = ev.source === 'schedule';
                const skipped = ev.status === 'skipped';
                const there = theirTimes(ev.people, ev.start);
                const sub = [
                  ev.people.length ? ev.people.map(p => p.name.split(' ')[0]).join(', ') : ev.attendee_count ? `${ev.attendee_count} people` : '',
                  skipped ? 'Cancelled' : ev.status === 'moved' ? `Moved from ${new Date(ev.original_start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '',
                  !skipped && there
                ].filter(Boolean).join(' · ');
                return (
                  <div key={ev.key} className="event" style={skipped ? { opacity: 0.55 } : undefined}>
                    <div className="when" style={skipped ? { textDecoration: 'line-through' } : undefined}>{timeLabel(ev)}</div>
                    <div className="what" role="button" tabIndex={0} style={{ cursor: 'pointer' }}
                      onClick={() => (sched ? setOcc(ev) : setMeeting(ev))} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (sched) setOcc(ev); else setMeeting(ev); } }}>
                      <b>{ev.title}</b>
                      <div className="row" style={{ gap: 8, marginTop: 4 }}>
                        {ev.people.length > 0 && <span className="avatars">{ev.people.slice(0, 4).map(p => <Avatar key={p.id} person={p} size={24} />)}</span>}
                        <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
                      </div>
                    </div>
                    {skipped ? (
                      <button className="btn small" onClick={async () => { await api.del(`/schedule-occurrence?key=${encodeURIComponent(ev.key)}`); load(); }}>Undo</button>
                    ) : !sched && !ev.people.length ? (
                      <button className="btn small ghost" onClick={() => setMeeting(ev)}>Add people</button>
                    ) : ev.people.length > 0 && (
                      <button className={`btn small${ev.prep ? '' : ' primary'}`} onClick={() => openPrep(ev)}>
                        {ev.prep ? 'Prep ✓' : 'Prep'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {events.length > 0 && <p className="small muted">Tap a meeting to choose who’s in it, take notes{events.some(e => e.source === 'schedule') ? ', or move or cancel a recurring one' : ''}.</p>}
        </div>
      )}

      {/* ---------- Follow-ups ---------- */}
      <div className="section-head"><Icon name="check" size={20} /><h2>Follow-ups</h2>
        {!selecting && <button className="btn ghost small" onClick={() => setAddOpen(true)}><Icon name="plus" size={15} /> Add</button>}
        {list.length > 0 && !selecting && <button className="btn ghost small" onClick={() => setUpdateOpen(true)} title="Give an update: say what’s changed and Heartwood settles the follow-ups it affects">Update</button>}
        {list.length > 0 && <button className="btn ghost small" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Cancel' : 'Select'}</button>}
      </div>
      <div className="card" style={{ padding: '10px 16px' }}>
        {lastTidy ? (
          <div className="banner" style={{ margin: '4px 0 10px' }}>
            <span className="grow">Archived {lastTidy.archived} older follow-up{lastTidy.archived === 1 ? '' : 's'}.</span>
            <button className="btn small" onClick={undoTidy}>Undo</button>
          </div>
        ) : data.followups_old >= 10 && !selecting && (
          <div className="banner warn" style={{ margin: '4px 0 10px' }}>
            <span className="grow">{data.followups_old} are from notes more than 3 months old.</span>
            <button className="btn small" onClick={() => setTidyOpen(true)}>Tidy up</button>
          </div>
        )}
        <div className="seg" style={{ marginBottom: 6 }}>
          <button aria-pressed={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => { setTab('mine'); setShown(3); setShowSomeday(false); setPicked(new Set()); }}>Yours · {followups.mine.length}</button>
          <button aria-pressed={tab === 'theirs'} className={tab === 'theirs' ? 'on' : ''} onClick={() => { setTab('theirs'); setShown(3); setShowSomeday(false); setPicked(new Set()); }} aria-label={`Waiting on others, ${followups.theirs.length}`}>Waiting · {followups.theirs.length}</button>
        </div>
        {tab === 'mine' && doneToday > 0 && (
          <p className={`done-today${doneToday >= 3 ? ' cleared' : ''}`} role="status">
            <Icon name="check" size={16} /> {doneToday >= 3 ? `${doneToday} handled today. That’s a good day; anything else is a bonus.` : `${doneToday} handled today`}
          </p>
        )}
        {list.length === 0 && <p className="muted small">{tab === 'mine' ? (later.length ? 'Nothing pressing. Older ones are waiting in Someday.' : 'Nothing open. Follow-ups from your notes and reflections show up here.') : 'Nothing you’re waiting on right now.'}</p>}
        {list.length > 0 && shown <= 3 && !selecting && <p className="small muted" style={{ margin: '0 0 2px' }}>{tab === 'mine' ? 'Your top three' : 'The top three'}{list.length > 3 ? `, of ${list.length}` : ''}</p>}
        {list.slice(0, shown).map(f => <FollowupItem key={f.id} f={f} onChange={load} selecting={selecting} selected={picked.has(f.id)} onSelect={pick} />)}
        {list.length > shown && <div className="list-more">
          <button className="btn ghost small" onClick={() => setShown(shown + 10)}>{shown <= 3 ? `See ${Math.min(10, list.length - shown)} more` : `Show ${Math.min(10, list.length - shown)} more`}</button>
        </div>}
        {later.length > 0 && !selecting && <>
          <button className="btn ghost small someday-toggle" onClick={() => setShowSomeday(!showSomeday)} aria-expanded={showSomeday}>
            {showSomeday ? 'Hide Someday' : `Someday · ${later.length}`}
          </button>
          {showSomeday && <>
            <p className="small muted" style={{ margin: '4px 0' }}>Older than a month and not pressing. Do one, let one go, or leave them be.</p>
            {later.slice(0, 40).map(f => <FollowupItem key={f.id} f={f} onChange={load} />)}
            {later.length > 40 && <p className="small muted">+ {later.length - 40} more</p>}
          </>}
        </>}
        {selecting ? (
          <div className="row wrap" style={{ gap: 8, marginTop: 10, position: 'sticky', bottom: 'calc(var(--tabbar-h) + var(--safe-b) + 8px)', background: 'var(--surface)', padding: '8px 0' }}>
            <span className="grow small muted">{picked.size} selected · <button type="button" className="linklike" onClick={() => setPicked(new Set(list.slice(0, shown).map(f => f.id)))}>Select all shown</button></span>
            <button className="btn small" disabled={!picked.size} onClick={() => bulk('archive')}>Archive</button>
            <button className="btn small primary" disabled={!picked.size} onClick={() => bulk('done')}>Mark done</button>
          </div>
        ) : tab === 'mine' && <AddFollowup onAdded={load} />}
        {!selecting && <div className="row" style={{ gap: 4, marginTop: 6 }}>
          <button className="btn ghost small" onClick={showDone}>{done ? 'Hide done' : 'Show done'}</button>
          <button className="btn ghost small" onClick={showArchived}>{archived ? 'Hide archived' : 'Show archived'}</button>
        </div>}
        {done && <>
          <div className="day-label" style={{ margin: '14px 0 2px' }}>Done</div>
          {done.length === 0 && <p className="muted small">Nothing ticked off yet.</p>}
          {done.slice(0, 30).map(f => <FollowupItem key={f.id} f={f} onChange={() => { load(); api.get('/followups?status=done').then(setDone); }} />)}
        </>}
        {archived && <>
          <div className="day-label" style={{ margin: '14px 0 2px' }}>Archived · {archived.length}</div>
          {archived.length === 0 && <p className="muted small">Nothing archived.</p>}
          {archived.slice(0, 60).map(f => <FollowupItem key={f.id} f={f} archived onChange={() => { load(); api.get('/followups?status=archived').then(setArchived); }} />)}
          {archived.length > 60 && <p className="small muted">+ {archived.length - 60} more</p>}
        </>}
      </div>

      {/* ---------- Check in ---------- */}
      {checkIns.length > 0 && <>
        <div className="section-head"><Icon name="people" size={20} /><h2>Say hi to</h2></div>
        <div className="card" style={{ padding: '6px 16px' }}>
          {checkIns.map(p => (
            <div key={p.id} className="event" style={{ alignItems: 'center' }}>
              <Avatar person={p} size={34} />
              <Link to={`/people/${p.id}`} className="what" style={{ textDecoration: 'none' }}>
                <b>{p.name}</b>
                <span className="small muted sayhi-reason">{p.reason || (p.last_entry_at ? `Last note ${formatDate(p.last_entry_at).toLowerCase()}` : 'No notes yet')}</span>
              </Link>
              <button className="btn small" onClick={() => setPrep({ person: p, event: null, existingId: null })}>Prep</button>
            </div>
          ))}
        </div>
      </>}

      {!data.has_entries && (
        <div className="empty">
          <h2>Start with one note</h2>
          <p>Record a thought, write a note, or add files. Today fills in as your journal grows.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link to="/record" className="btn rec"><Icon name="mic" size={18} /> Record</Link>
            <button className="btn" onClick={() => nav('/journal?new=1')}><Icon name="note" size={18} /> Write</button>
          </div>
        </div>
      )}

      {meeting && <MeetingSheet uid={meeting.uid} ev={meeting.start ? meeting : undefined} onClose={() => setMeeting(null)} onChanged={load} onPrep={openPrep} />}
      <OccurrenceSheet occ={occ} onClose={() => setOcc(null)} onChanged={load} onPrep={openPrep} />
      {updateOpen && <RespondSheet open onClose={() => setUpdateOpen(false)} onApplied={load} />}
      <TidySheet open={tidyOpen} onClose={() => setTidyOpen(false)} onDone={r => { setLastTidy(r); setArchived(null); load(); }} />
      <PrepSheet open={!!prep} onClose={() => setPrep(null)} person={prep?.person} event={prep?.event} existingId={prep?.existingId} onCreated={load} />
    </main>
  );
}
