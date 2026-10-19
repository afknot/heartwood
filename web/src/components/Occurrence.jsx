import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import Avatar from './Avatar.jsx';
import { useApp } from '../lib/context.js';
import { differentZone, timeIn } from '../lib/time.js';

const pad = n => String(n).padStart(2, '0');
const toLocalInput = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const whenLong = iso => new Date(iso).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const firstName = p => p.name.split(' ')[0];

/** "11:15 AM for Sam" for anyone in a different time zone at that moment. */
export function theirTimes(people, iso) {
  return people.filter(p => differentZone(p.tz, new Date(iso))).map(p => `${timeIn(p.tz, iso)} for ${firstName(p)}`).join(' · ');
}

/**
 * One conversation from a recurring schedule: prep, take notes, move it, cancel it, or undo.
 * `occ` is an occurrence from /api/today (source: 'schedule').
 */
export function OccurrenceSheet({ occ, onClose, onChanged, onPrep }) {
  const nav = useNavigate();
  const { notify } = useApp();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMoving(false); setWhen(occ ? toLocalInput(occ.start) : ''); }, [occ]);
  if (!occ) return null;
  const ids = occ.people.map(p => p.id);
  const kind = ids.length === 1 ? 'one_on_one' : 'meeting';
  const skipped = occ.status === 'skipped';
  const there = theirTimes(occ.people, occ.start);

  async function act(body) {
    setBusy(true);
    try {
      if (body) await api.post('/schedule-occurrence', { key: occ.key, ...body });
      else await api.del(`/schedule-occurrence?key=${encodeURIComponent(occ.key)}`);
      onChanged?.(); onClose();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }

  async function writeNote() {
    const e = await api.post('/entries', { kind, people: ids, title: `${occ.title} · ${new Date(occ.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}` });
    nav(`/entry/${e.id}?fresh=1`);
  }

  return (
    <Sheet open onClose={onClose} title={occ.title}>
      <p className="small muted" style={{ marginTop: -8 }}>
        {whenLong(occ.start)}{skipped ? ' · cancelled' : ''}
        {occ.status === 'moved' && <><br />Moved from {whenLong(occ.original_start)}</>}
        {there && <><br />{there}</>}
      </p>
      <div className="chips" style={{ marginBottom: 12 }}>
        {occ.people.map(p => <Link key={p.id} to={`/people/${p.id}`} className="chip" style={{ paddingLeft: 4 }} onClick={onClose}><Avatar person={p} size={22} /> {p.name}</Link>)}
      </div>

      {skipped ? (
        <button className="btn primary block" disabled={busy} onClick={() => act(null)}>Undo cancel</button>
      ) : moving ? (
        <form onSubmit={e => { e.preventDefault(); act({ action: 'move', new_start: new Date(when).toISOString() }); }}>
          <label className="field"><span>New date and time</span>
            <input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required />
          </label>
          <p className="small muted" style={{ marginTop: -4 }}>Only this one moves. The rest of the schedule stays the same.</p>
          <button className="btn primary block" disabled={busy || !when}>Move it</button>
          <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setMoving(false)}>Back</button>
        </form>
      ) : <>
        <button className="btn primary block" onClick={() => { onClose(); onPrep(occ); }}>
          <Icon name="sparkle" size={18} /> {occ.prep ? 'Open prep' : 'Prep'}
        </button>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Link className="btn rec" style={{ flex: 1 }} to={`/record?kind=${kind}&person=${ids.join(',')}`}><Icon name="mic" size={18} /> Record</Link>
          <button className="btn" style={{ flex: 1 }} onClick={writeNote}><Icon name="note" size={18} /> Write notes</button>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setMoving(true)}><Icon name="calendar" size={18} /> Reschedule</button>
          <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => act({ action: 'skip' })}>Cancel this one</button>
        </div>
        {occ.status === 'moved' && <button className="btn ghost block" style={{ marginTop: 8 }} disabled={busy} onClick={() => act(null)}>Put it back to the usual time</button>}
      </>}
      <Link className="btn ghost block" style={{ marginTop: 8 }} to={`/schedule?edit=${occ.schedule_id}`} onClick={onClose}>Edit the recurring schedule</Link>
    </Sheet>
  );
}
