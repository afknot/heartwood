// Review screen for splitting a running log (e.g. years of 1:1 notes) into one entry per dated section.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useApp } from '../lib/context.js';
import { RELATIONSHIPS } from '../lib/format.js';

const AI = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date');

export default function Import() {
  const { id } = useParams();
  const nav = useNavigate();
  const { people, notify } = useApp();
  const [imp, setImp] = useState(null);
  const [plan, setPlan] = useState([]);
  const [personId, setPersonId] = useState('');
  const [provider, setProvider] = useState('your AI provider');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.get(`/imports/${id}`).then(r => {
      setImp(r);
      setPersonId(r.person_id || '');
      setPlan(r.segments.map(s => ({ index: s.index, include: !s.duplicate && s.chars > 0, merge: false, date: s.date || '' })));
      if (r.status === 'committed') setWorking(true);
    }).catch(e => { notify(e.message); nav(-1); });
    api.get('/settings').then(r => setProvider(AI[r.settings.ai_provider] || 'your AI provider')).catch(() => {});
  }, [id, nav, notify]);

  const groups = useMemo(() => {
    let n = 0;
    plan.forEach((p, i) => { if (p.include && !(p.merge && plan.slice(0, i).some(q => q.include))) n++; });
    return n;
  }, [plan]);
  const upd = (i, patch) => setPlan(plan.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const person = people.find(p => p.id === personId);
  const dated = plan.filter(p => p.include && p.date).map(p => p.date).sort();
  const dupes = imp?.segments.filter(s => s.duplicate).length || 0;

  async function commit() {
    setBusy(true); setErr('');
    try { await api.post(`/imports/${id}/commit`, { person_id: personId || null, segments: plan }); setWorking(true); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!working) return;
    let alive = true;
    const tick = () => api.get(`/imports/${id}`).then(r => alive && setStatus(r)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [working, id]);
  const done = status?.progress && status.progress.pending === 0;

  if (!imp) return <main className="page no-tabs" />;

  return (
    <main className="page no-tabs">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ fontSize: 24 }}>Split into entries</h1>
      </div>

      {!working && <>
        <div className="card mb">
          <div style={{ fontWeight: 600 }}>{imp.file_name}</div>
          <div className="small muted">
            {imp.segments.length} sections{dated.length > 1 && ` · ${fmtDate(dated[0])} to ${fmtDate(dated.at(-1))}`}{dupes > 0 && ` · ${dupes} already in your journal`}
          </div>
        </div>

        <label className="field"><span>Who are these with? <small>(optional)</small></span>
          <select className="select" value={personId} onChange={e => setPersonId(e.target.value)}>
            <option value="">No one in particular</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : (RELATIONSHIPS[p.relationship] ? ` · ${RELATIONSHIPS[p.relationship]}` : '')}</option>)}
          </select>
        </label>

        <p className="small muted" style={{ marginTop: 0 }}>Each checked section becomes its own entry on its own date. Uncheck what you don’t want, fix a wrong date, or join a section with the one above when the “date” was only a mention.</p>

        {imp.segments.map((s, i) => {
          const p = plan[i];
          return (
            <div key={i} className="card" style={{ marginBottom: 8, opacity: p.include ? 1 : 0.5, padding: 12 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={p.include} onChange={e => upd(i, { include: e.target.checked })} style={{ width: 20, height: 20, marginTop: 4, accentColor: 'var(--accent)' }} aria-label="Include" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <input className="input" type="date" value={p.date} onChange={e => upd(i, { date: e.target.value })}
                      style={{ width: 'auto', minHeight: 34, padding: '4px 8px', fontSize: 14 }} disabled={!p.include || p.merge} />
                    {s.duplicate && <span className="chip">Already in journal</span>}
                    {i > 0 && p.include && <button aria-pressed={p.merge} className={`chip${p.merge ? ' on' : ''}`} onClick={() => upd(i, { merge: !p.merge })}>{p.merge ? 'Joined with above' : 'Join with above'}</button>}
                  </div>
                  {s.heading && <div className="small" style={{ fontWeight: 600, marginTop: 6 }}>{s.heading}</div>}
                  <div className="small muted" style={{ marginTop: 4 }}>{s.preview || '(empty)'}{s.chars > 240 ? '…' : ''}</div>
                </div>
              </div>
            </div>
          );
        })}

        <div className="banner info mt"><span className="grow">Each entry is sent to {provider} for a short summary{person ? `, then Heartwood writes a fresh brief for ${person.name.split(' ')[0]}` : ''}.</span></div>
        {err && <div className="banner error" role="alert">{err}</div>}
        <button className="btn primary block" disabled={busy || groups === 0} onClick={commit}>
          {busy ? 'Saving…' : `Create ${groups} ${groups === 1 ? 'entry' : 'entries'}`}
        </button>
      </>}

      {working && (
        <div className="empty">
          {!done ? <span className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px', display: 'block' }} /> : <Icon name="check" size={40} style={{ margin: '0 auto 12px' }} />}
          <h2>{done ? 'All set' : 'Writing your entries…'}</h2>
          {status?.progress && <p>{status.progress.done} of {status.progress.total} done{status.progress.failed ? ` · ${status.progress.failed} need a retry` : ''}</p>}
          <p className="small">You can leave this page; it keeps going on the server.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            {personId && <Link className="btn primary" to={`/people/${personId}`}>Go to {person?.name.split(' ')[0] || 'person'}</Link>}
            <Link className="btn" to="/journal">Journal</Link>
          </div>
        </div>
      )}
    </main>
  );
}
