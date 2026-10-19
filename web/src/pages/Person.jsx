import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import EntryItem from '../components/EntryItem.jsx';
import Avatar from '../components/Avatar.jsx';
import Growth from '../components/Growth.jsx';
import { FollowupItem, AddFollowup, PrepSheet, RespondSheet } from '../components/Followups.jsx';
import { ReadTrend } from '../components/TeamWeek.jsx';
import ContextBar from '../components/ContextBar.jsx';
import { PersonForm } from './People.jsx';
import { useApp } from '../lib/context.js';
import { RELATIONSHIPS, formatDate, renderMarkdown } from '../lib/format.js';
import { describeSchedule } from '../components/ScheduleForm.jsx';
import { differentZone, relativeZone, timeIn, tzLabel } from '../lib/time.js';

export default function Person() {
  const { id } = useParams();
  const nav = useNavigate();
  const { refreshPeople, notify } = useApp();
  const [p, setP] = useState(null);
  const [entries, setEntries] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [followups, setFollowups] = useState([]);
  const [prepOpen, setPrepOpen] = useState(false); // false | 'prep' | 'agenda'
  const [updating, setUpdating] = useState(false);
  const [allFollowups, setAllFollowups] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef();
  // Slim sticky header once the big one scrolls away, so you always know whose page this is.
  const headerRef = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new window.IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-40px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [p]);
  const [schedules, setSchedules] = useState([]);
  useEffect(() => { api.get(`/schedules?person=${id}`).then(setSchedules).catch(() => {}); }, [id]);
  const [meetings, setMeetings] = useState([]); // upcoming invites / calendar meetings with them, one per series
  useEffect(() => { api.get(`/meetings?person=${id}`).then(setMeetings).catch(() => {}); }, [id]);
  const [, tick] = useState(0); // keep "their time" current
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60e3); return () => clearInterval(t); }, []);
  const loadFollowups = useCallback(() => api.get(`/followups?person=${id}`).then(setFollowups).catch(() => {}), [id]);
  useEffect(() => { loadFollowups(); }, [loadFollowups]);

  async function uploadPhoto(file) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const form = new FormData();
      form.append('photo', file, file.name);
      const res = await fetch(`/api/people/${id}/photo`, { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setP(data); refreshPeople();
    } catch (e) { notify(e.message); }
    finally { setPhotoBusy(false); }
  }

  useEffect(() => {
    api.get(`/people/${id}`).then(setP).catch(() => nav('/people'));
    api.get(`/entries?person=${id}&limit=50`).then(setEntries).catch(() => {});
    api.get(`/reports?person=${id}`).then(async list => {
      setBriefs(list);
      if (list[0]) setBrief(await api.get(`/reports/${list[0].id}`));
    }).catch(() => {});
  }, [id, nav]);

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post(`/people/${id}/brief`);
      setBrief(r);
      setBriefs([r, ...briefs]);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }

  async function save(f) {
    setP(await api.patch(`/people/${id}`, f));
    refreshPeople();
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`Remove ${p.name}? Their entries stay in your journal, but they'll be unlinked.`)) return;
    await api.del(`/people/${id}`);
    refreshPeople();
    nav('/people', { replace: true });
  }

  if (!p) return <main className="page" />;

  return (
    <main className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/people')} aria-label="Back"><Icon name="back" /></button>
        <span className="spacer" />
        <button className="btn small" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <div className={`person-bar${compact ? ' show' : ''}`} aria-hidden={!compact}>
        <div className="person-bar-inner">
          <button className="icon-btn" onClick={() => nav('/people')} aria-label="Back" tabIndex={compact ? 0 : -1}><Icon name="back" /></button>
          <button type="button" className="person-bar-who" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} tabIndex={compact ? 0 : -1} aria-label={`${p.name}, scroll to top`}>
            <Avatar person={p} size={30} />
            <span className="grow" style={{ textAlign: 'left' }}>
              <b>{p.name}</b>
              <small>{[p.pronouns, p.role, RELATIONSHIPS[p.relationship]].filter(Boolean).join(' · ')}</small>
            </span>
          </button>
          <button className="btn small" onClick={() => setPrepOpen('prep')} tabIndex={compact ? 0 : -1}><Icon name="sparkle" size={15} /> Prep</button>
        </div>
      </div>
      <div className="row" style={{ gap: 14 }} ref={headerRef}>
        <button onClick={() => photoInput.current.click()} title={p.photo ? 'Change photo' : 'Add a photo'} aria-label="Change photo"
          style={{ border: 0, padding: 0, background: 'none', position: 'relative', cursor: 'pointer', opacity: photoBusy ? 0.5 : 1 }}>
          <Avatar person={p} size={64} />
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', color: 'var(--ink-2)' }}><Icon name="camera" size={13} /></span>
        </button>
        <input ref={photoInput} type="file" accept="image/*,.heic,.heif" hidden onChange={e => { uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <div>
          <h1 className="person-name">{p.name}</h1>
          <div className="muted small">{[p.pronouns, p.role, RELATIONSHIPS[p.relationship]].filter(Boolean).join(' · ')}</div>
          {(p.city || p.tz) && <div className="muted small" title={p.tz ? tzLabel(p.tz) : undefined}>
            {[p.city, p.tz && (differentZone(p.tz) ? `${timeIn(p.tz)} there, ${relativeZone(p.tz)}` : !p.city ? tzLabel(p.tz) : 'same time as you')].filter(Boolean).join(' · ')}
          </div>}
        </div>
      </div>
      {p.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{p.notes}</p>}

      <div className="row mt wrap">
        <Link to={`/record?kind=one_on_one&person=${p.id}`} className="btn rec small nowrap"><Icon name="mic" size={16} /> Record a 1:1</Link>
        <Link to={`/add?person=${p.id}`} className="btn small nowrap"><Icon name="clip" size={16} /> Add files</Link>
        <button className="btn small nowrap" onClick={() => setPrepOpen('prep')}><Icon name="sparkle" size={16} /> Prep</button>
        <button className="btn small nowrap" onClick={() => setPrepOpen('agenda')}><Icon name="check" size={16} /> 1:1 agenda</button>
        <Link to={`/career?recognize=${p.id}#drafts`} className="btn small nowrap" title={`Draft a LinkedIn kudos post for ${p.name.split(' ')[0]}`}><Icon name="star" size={16} /> Kudos</Link>
      </div>

      <ContextBar subject={{ kind: 'person', id: p.id, label: p.name }} recipients={[p]} />

      <section className="card mt" style={{ padding: '10px 16px' }}>
        <div className="analysis-head"><Icon name="repeat" /><h2 style={{ fontSize: 18 }}>Recurring</h2></div>
        {schedules.map(s => (
          <Link key={s.id} to={`/schedule?edit=${s.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit', padding: '6px 0', opacity: s.active ? 1 : 0.6 }}>
            <span className="grow">
              <b style={{ fontWeight: 600 }}>{s.display_title}</b>{!s.active && <span className="small muted"> · paused</span>}
              <span className="small muted" style={{ display: 'block' }}>{describeSchedule(s)}{s.active && s.next[0] ? ` · next ${new Date(s.next[0].start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</span>
            </span>
            <Icon name="chevron" size={18} />
          </Link>
        ))}
        {meetings.map(m => (
          <div key={m.uid} className="row" style={{ padding: '6px 0' }}>
            <span className="grow">
              <b style={{ fontWeight: 600 }}>{m.title}</b>
              <span className="small muted" style={{ display: 'block' }}>From your {m.source === 'invite' ? 'invites' : 'calendar'} · next {new Date(m.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </span>
          </div>
        ))}
        {!schedules.length && !meetings.length && <p className="muted small" style={{ margin: '4px 0' }}>No regular 1:1 with {p.name.split(' ')[0]} yet.</p>}
        <Link to={`/schedule?new=1&person=${p.id}`} className="btn ghost small" style={{ marginTop: 4, paddingLeft: 0 }}><Icon name="plus" size={16} /> {schedules.length ? 'Add another' : 'Set up a recurring 1:1'}</Link>
      </section>

      {p.relationship === 'direct_report' && <ReadTrend person={p} />}

      <section className="card mt" style={{ padding: '10px 16px' }}>
        <div className="analysis-head"><Icon name="check" /><h2 style={{ fontSize: 18 }}>Open follow-ups</h2>
          {followups.length > 0 && <button className="btn ghost small" onClick={() => setUpdating(true)}>Give an update</button>}
        </div>
        {updating && <RespondSheet open onClose={() => setUpdating(false)} personId={p.id} onApplied={loadFollowups} />}
        {followups.length === 0 && <p className="muted small" style={{ margin: '4px 0' }}>Nothing open with {p.name.split(' ')[0]}.</p>}
        {followups.slice(0, allFollowups ? followups.length : 5).map(f => <FollowupItem key={f.id} f={f} onChange={loadFollowups} showPerson={false} />)}
        {followups.length > 5 && <button type="button" className="btn ghost small" onClick={() => setAllFollowups(!allFollowups)}>{allFollowups ? 'Show fewer' : `Show all ${followups.length}`}</button>}
        <AddFollowup personId={p.id} onAdded={loadFollowups} />
      </section>

      {p.relationship === 'direct_report' && <Growth person={p} entryCount={entries.length} />}

      <section className="card mt">
        <div className="analysis-head">
          <Icon name="sparkle" /><h2>Relationship brief</h2>
          <button className="btn small" onClick={generate} disabled={busy || !entries.length}>
            {busy ? <><span className="spinner" /> Writing…</> : brief ? 'Refresh' : 'Generate'}
          </button>
        </div>
        {!brief && !busy && <p className="muted small">{entries.length ? `Pulls together your ${entries.length} entries with ${p.name.split(' ')[0]}: where things stand, what they need, open loops, and what to do in your next 1:1.` : `Link entries to ${p.name.split(' ')[0]} to get a brief.`}</p>}
        {brief && <>
          <p className="small muted" style={{ marginTop: 0 }}>Written {formatDate(brief.created_at, { time: true })} from {brief.entry_count} entries</p>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(brief.content_md) }} />
          {briefs.length > 1 && <details className="mt"><summary className="small muted">Earlier briefs</summary>
            <div className="chips mt">{briefs.slice(1).map(b => <button key={b.id} className="chip" onClick={async () => setBrief(await api.get(`/reports/${b.id}`))}>{formatDate(b.created_at)}</button>)}</div>
          </details>}
        </>}
      </section>

      <div className="day-label">Entries</div>
      {entries.map(e => <EntryItem key={e.id} e={e} />)}
      {!entries.length && <p className="muted small">No entries yet. Add {p.name.split(' ')[0]} to a note or recording.</p>}

      <PrepSheet open={!!prepOpen} initialTab={prepOpen || 'prep'} onClose={() => setPrepOpen(false)} person={p} event={null} />

      <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${p.name}`}>
        <PersonForm initial={p} onSubmit={save} />
        {p.photo && <button className="btn block mt" onClick={async () => { setP(await api.del(`/people/${id}/photo`)); refreshPeople(); }}>Remove photo</button>}
        <button className="btn block danger mt" onClick={remove}><Icon name="trash" size={18} /> Remove person</button>
      </Sheet>
    </main>
  );
}
