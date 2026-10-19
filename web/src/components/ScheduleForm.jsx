import { useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { PeoplePicker } from './Pickers.jsx';
import { useApp } from '../lib/context.js';

export const CADENCES = [
  { v: 'w1', label: 'Every week', frequency: 'weekly', interval_weeks: 1 },
  { v: 'w2', label: 'Every 2 weeks', frequency: 'weekly', interval_weeks: 2 },
  { v: 'w3', label: 'Every 3 weeks', frequency: 'weekly', interval_weeks: 3 },
  { v: 'w4', label: 'Every 4 weeks', frequency: 'weekly', interval_weeks: 4 },
  { v: 'w6', label: 'Every 6 weeks', frequency: 'weekly', interval_weeks: 6 },
  { v: 'w8', label: 'Every 8 weeks', frequency: 'weekly', interval_weeks: 8 },
  { v: 'm', label: 'Monthly (same weekday)', frequency: 'monthly', interval_weeks: 4 },
  { v: 'once', label: 'Just once', frequency: 'once', interval_weeks: 1 }
];
const cadenceOf = s => (s.frequency === 'monthly' ? 'm' : s.frequency === 'once' ? 'once' : `w${s.interval_weeks}`);

const NTH = ['1st', '2nd', '3rd', '4th', 'last'];
const pad = n => String(n).padStart(2, '0');
const ymdLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Every 2 weeks on Thursday at 2:15 PM" */
export function describeSchedule(s) {
  const d = new Date(`${s.anchor_date}T${s.time}:00`);
  const day = d.toLocaleDateString([], { weekday: 'long' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (s.frequency === 'once') return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly on the ${NTH[Math.min(4, Math.ceil(d.getDate() / 7) - 1)]} ${day} at ${time}`;
  const c = CADENCES.find(x => x.v === cadenceOf(s));
  return `${c ? c.label : 'Every week'} on ${day} at ${time}`;
}

/** Next few dates, for the preview under the form. */
function preview(f) {
  if (!f.anchor_date) return [];
  const start = new Date(`${f.anchor_date}T${f.time || '10:00'}:00`);
  if (f.frequency === 'once') return [start];
  const out = [];
  if (f.frequency === 'monthly') {
    const nth = Math.ceil(start.getDate() / 7), wd = start.getDay();
    for (let i = 0; i < 3; i++) {
      const m = new Date(start.getFullYear(), start.getMonth() + i, 1, start.getHours(), start.getMinutes());
      let day = 1 + ((wd - m.getDay() + 7) % 7) + (nth - 1) * 7;
      const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      if (day > dim) day -= 7;
      m.setDate(day); out.push(m);
    }
    return out;
  }
  for (let i = 0; i < 3; i++) { const d = new Date(start); d.setDate(start.getDate() + i * 7 * f.interval_weeks); out.push(d); }
  return out;
}

export default function ScheduleForm({ initial = {}, onSaved, onDeleted, onCancel }) {
  const { people } = useApp();
  const [f, setF] = useState(() => ({
    title: '', frequency: 'weekly', interval_weeks: 2, time: '10:00', duration_min: 30,
    anchor_date: ymdLocal(new Date()), active: true, ...initial,
    people: (initial.people || []).map(p => (typeof p === 'string' ? p : p.id))
  }));
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chosen = people.filter(p => f.people.includes(p.id));
  const dates = useMemo(() => preview(f), [f]);
  const set = patch => { setF({ ...f, ...patch }); setErr(''); };

  async function save(e) {
    e.preventDefault();
    if (!f.people.length) return setErr('Pick who it’s with.');
    setBusy(true);
    try {
      const body = { ...f, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
      const s = initial.id ? await api.patch(`/schedules/${initial.id}`, body) : await api.post('/schedules', body);
      onSaved?.(s);
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <div className="field"><span>With</span>
        <div className="chips">
          {chosen.map(p => <span key={p.id} className="chip accent" style={{ paddingLeft: 4 }}><Avatar person={p} size={22} /> {p.name}</span>)}
          <button type="button" className="chip" onClick={() => setPicker(true)}><Icon name="plus" size={14} /> {chosen.length ? 'Edit' : 'Add people'}</button>
        </div>
      </div>
      <label className="field"><span>How often</span>
        <select className="select" value={cadenceOf(f)} onChange={e => { const c = CADENCES.find(x => x.v === e.target.value); set({ frequency: c.frequency, interval_weeks: c.interval_weeks }); }}>
          {CADENCES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <label className="field" style={{ flex: 1.3 }}><span>{f.frequency === 'once' ? 'Date' : 'Next one'}</span>
          <input className="input" type="date" value={f.anchor_date} onChange={e => set({ anchor_date: e.target.value })} required />
        </label>
        <label className="field" style={{ flex: 1 }}><span>Time</span>
          <input className="input" type="time" value={f.time} onChange={e => set({ time: e.target.value })} required />
        </label>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <label className="field" style={{ flex: 1 }}><span>Length</span>
          <select className="select" value={f.duration_min} onChange={e => set({ duration_min: Number(e.target.value) })}>
            {[15, 20, 25, 30, 45, 50, 60, 90].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1.3 }}><span>Name <small>(optional)</small></span>
          <input className="input" value={f.title} onChange={e => set({ title: e.target.value })}
            placeholder={chosen.length === 1 ? `1:1 with ${chosen[0].name.split(' ')[0]}` : chosen.length ? 'Check-in' : '1:1'} />
        </label>
      </div>
      {dates.length > 0 && <p className="small muted" style={{ marginTop: -4 }}>
        {f.frequency === 'once' ? 'On ' : 'Next: '}{dates.map(d => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })).join(' · ')}{f.frequency !== 'once' ? ' …' : ''}
      </p>}
      {initial.id && (
        <label className="toggle" style={{ borderTop: 0 }}>
          <span className="grow">Active<small>Pause it without losing the schedule.</small></span>
          <span className="switch"><input type="checkbox" checked={!!f.active} onChange={e => set({ active: e.target.checked })} /><i /></span>
        </label>
      )}
      {err && <div className="banner error" role="alert">{err}</div>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : initial.id ? 'Save' : 'Add'}</button>
      {initial.id && <button type="button" className="btn block danger" style={{ marginTop: 8 }} onClick={async () => {
        if (!confirm('Delete this recurring conversation? Past notes stay; future dates disappear from Today.')) return;
        await api.del(`/schedules/${initial.id}`); onDeleted?.();
      }}>Delete</button>}
      {onCancel && <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={onCancel}>Cancel</button>}
      <PeoplePicker open={picker} onClose={() => setPicker(false)} selected={f.people} onChange={ids => set({ people: ids })} />
    </form>
  );
}
