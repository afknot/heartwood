import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import Avatar from '../components/Avatar.jsx';
import ScheduleForm, { describeSchedule } from '../components/ScheduleForm.jsx';
import { theirTimes } from '../components/Occurrence.jsx';
import { MeetingSheet } from '../components/MeetingSheet.jsx';
import { useApp } from '../lib/context.js';

const short = iso => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export default function Schedule() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, schedule for edit
  const [series, setSeries] = useState(null); // recurring meetings from invites and your calendar
  const [meeting, setMeeting] = useState(null);
  const loadSeries = useCallback(() => api.get('/meetings/series').then(setSeries).catch(() => setSeries([])), []);
  useEffect(() => { loadSeries(); }, [loadSeries]);

  const load = useCallback(() => api.get('/schedules').then(setList).catch(e => notify(e.message)), [notify]);
  useEffect(() => { load(); }, [load]);
  // Deep links: /schedule?edit=<id>, /schedule?new=1&person=<id>
  useEffect(() => {
    if (!list) return;
    const id = params.get('edit');
    if (id) { const s = list.find(x => x.id === id); if (s) setEditing(s); setParams({}, { replace: true }); }
    else if (params.get('new')) { setEditing({ people: params.get('person') ? [params.get('person')] : [] }); setParams({}, { replace: true }); }
  }, [list, params, setParams]);

  const done = () => { setEditing(null); load(); };
  const active = (list || []).filter(s => s.active);
  const paused = (list || []).filter(s => !s.active);

  const row = s => {
    const there = s.next[0] ? theirTimes(s.people, s.next[0].start) : '';
    return (
      <button key={s.id} className="event" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', alignItems: 'center' }} onClick={() => setEditing(s)}>
        <span className="avatars">{s.people.slice(0, 3).map(p => <Avatar key={p.id} person={p} size={32} />)}</span>
        <span className="what">
          <b>{s.display_title}</b>
          <span className="small muted" style={{ display: 'block' }}>{describeSchedule(s)}{there ? ` · ${there}` : ''}</span>
          {s.active && <span className="small muted" style={{ display: 'block' }}>
            {s.next.length ? `Next: ${s.next.map(o => short(o.start) + (o.status === 'moved' ? ' (moved)' : '')).join(' · ')}` : 'Nothing coming up'}
          </span>}
        </span>
        <Icon name="chevron" size={18} />
      </button>
    );
  };

  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ flex: 1 }}>Recurring</h1>
        <button className="icon-btn" onClick={() => setEditing({})} aria-label="Add a recurring conversation"><Icon name="plus" /></button>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>Your regular 1:1s and check-ins. Meetings you’ve invited Heartwood to come in on their own and stay in sync when the organizer changes them, so you only need to add ones that aren’t on an invite.</p>

      {series?.length > 0 && <>
        <div className="day-label">From your invites{series.some(m => m.source === 'calendar') ? ' and calendar' : ''}</div>
        <div className="card" style={{ padding: '0 16px' }}>
          {series.map(m => (
            <button key={m.uid} className="event" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', alignItems: 'center' }} onClick={() => setMeeting(m)}>
              <span className="avatars">{m.people.slice(0, 3).map(p => <Avatar key={p.id} person={p} size={32} />)}</span>
              <span className="what">
                <b>{m.title}</b>
                <span className="small muted" style={{ display: 'block' }}>{[m.cadence || 'Recurring', m.people.length ? m.people.map(p => p.name.split(' ')[0]).join(', ') : 'Tap to add who’s in it'].join(' · ')}</span>
                <span className="small muted" style={{ display: 'block' }}>Next: {m.upcoming.map(short).join(' · ')}</span>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </div>
        <div className="day-label">Added in Heartwood</div>
      </>}

      {list && !list.length && series?.length > 0 && (
        <div className="card">
          <p className="small muted" style={{ marginTop: 0 }}>Nothing added here yet. Add a regular conversation that isn’t on an invite, like a standing walk-and-talk.</p>
          <button className="btn small" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Add one</button>
        </div>
      )}
      {list && !list.length && !series?.length && (
        <div className="empty">
          <h2>Add your recurring 1:1s</h2>
          <p>Pick the person, how often you meet, and the date of the next one. Staggered every-other-week schedules work fine: just set each one’s next date.</p>
          <button className="btn primary mt" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Add one</button>
        </div>
      )}
      {active.length > 0 && <div className="card" style={{ padding: '0 16px' }}>{active.map(row)}</div>}
      {paused.length > 0 && <>
        <div className="day-label">Paused</div>
        <div className="card" style={{ padding: '0 16px', opacity: 0.7 }}>{paused.map(row)}</div>
      </>}

      {meeting && <MeetingSheet uid={meeting.uid} onClose={() => setMeeting(null)} onChanged={loadSeries} onPrep={() => nav('/')} />}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit recurring' : 'Add a recurring conversation'}>
        {editing && <ScheduleForm key={editing.id || 'new'} initial={editing} onSaved={done} onDeleted={done} />}
      </Sheet>
    </main>
  );
}
