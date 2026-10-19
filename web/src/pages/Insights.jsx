import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ReflectNav from '../components/ReflectNav.jsx';
import { useApp } from '../lib/context.js';
import { formatDate, isoDay } from '../lib/format.js';

const PRESETS = [
  { k: '7', label: 'Past week', days: 7 },
  { k: '30', label: 'Past month', days: 30 },
  { k: '90', label: 'Past quarter', days: 90 },
  { k: 'custom', label: 'Custom' }
];

const FOCUS_IDEAS = [
  'How am I doing as a leader?',
  'Who on my team needs more from me?',
  'What am I avoiding?',
  'Where is my communication falling short?'
];

export default function Insights() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [reports, setReports] = useState([]);
  const [preset, setPreset] = useState('7');
  const [from, setFrom] = useState(isoDay(Date.now() - 6 * 864e5));
  const [to, setTo] = useState(isoDay(Date.now()));
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/reports').then(setReports).catch(() => {}); }, []);

  function choose(p) {
    setPreset(p.k);
    if (p.days) { setFrom(isoDay(Date.now() - (p.days - 1) * 864e5)); setTo(isoDay(Date.now())); }
  }

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post('/reports', {
        from, to, focus,
        from_iso: new Date(`${from}T00:00:00`).toISOString(),
        to_iso: new Date(`${to}T23:59:59.999`).toISOString()
      });
      nav(`/insights/${r.id}`);
    } catch (e) { notify(e.message); setBusy(false); }
  }

  return (
    <main className="page">
      <ReflectNav />
      <div className="topbar"><h1>Debriefs</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>Step back and see the patterns: recurring themes, how each relationship is going, open loops, and honest feedback on how you’re leading.</p>

      <section className="card">
        <div className="field"><span>Period</span>
          <div className="seg">{PRESETS.map(p => <button key={p.k} aria-pressed={preset === p.k} className={preset === p.k ? 'on' : ''} onClick={() => choose(p)}>{p.label}</button>)}</div>
        </div>
        {preset === 'custom' && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>From</span><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>To</span><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          </div>
        )}
        <label className="field"><span>Focus <small>(optional)</small></span>
          <input className="input" value={focus} onChange={e => setFocus(e.target.value)} placeholder="Anything you want it to dig into" />
        </label>
        <div className="chips mb">{FOCUS_IDEAS.map(f => <button key={f} className="chip" onClick={() => setFocus(f)}>{f}</button>)}</div>
        <button className="btn primary block" onClick={generate} disabled={busy}>
          {busy ? <><span className="spinner" /> Reading your journal… this can take a minute</> : <><Icon name="sparkle" size={18} /> Generate debrief</>}
        </button>
      </section>

      {reports.length > 0 && <>
        <h2 className="day-label">Past debriefs</h2>
        {reports.map(r => (
          <Link key={r.id} to={`/insights/${r.id}`} className="entry-item">
            <h3>{r.focus || `${formatDate(r.range_from + 'T12:00')} – ${formatDate(r.range_to + 'T12:00')}`}</h3>
            <div className="entry-meta" style={{ marginTop: 2 }}>
              <span>{r.range_from} → {r.range_to}</span><span className="dot">{r.entry_count} entries</span><span className="dot">{formatDate(r.created_at)}</span>
            </div>
          </Link>
        ))}
      </>}
    </main>
  );
}
