import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ReflectNav from '../components/ReflectNav.jsx';
import { useApp } from '../lib/context.js';
import { formatDate, isoDay } from '../lib/format.js';

const RANGES = [
  { k: '30', label: 'Past month', days: 30 },
  { k: '90', label: 'Past quarter', days: 90 },
  { k: '365', label: 'Past year', days: 365 },
  { k: 'custom', label: 'Custom' }
];
const KIND = { initiative: 'Initiative', outcome: 'Outcome', leadership: 'Leadership', decision: 'Decision', feedback: 'Feedback', learning: 'Learning', result: 'Outcome', built: 'Initiative' };
const DRAFTS = [
  { k: 'story', label: 'Story', hint: 'A leadership story for your portfolio, in its six-part structure. Exported as a pull request that lands on staging as a draft.' },
  { k: 'resume', label: 'Resume', hint: 'Suggested additions and edits to your career record. You pick which to keep, then export them as a pull request.' },
  { k: 'linkedin', label: 'LinkedIn', hint: 'A headline, About section, experience bullets and post ideas to paste into LinkedIn yourself. No job-seeking language.' },
  { k: 'recognition', label: 'Kudos', hint: 'Recognition for someone you work with: a line for your next 1:1, a message to them, a shout-out for the team, and a LinkedIn post and recommendation. Their name stays in; ask before anything public. Also on each person’s page.' }
];

export default function Career() {
  const nav = useNavigate();
  const loc = useLocation();
  const { notify, people } = useApp();
  const [tab, setTab] = useState(loc.hash === '#drafts' || new URLSearchParams(loc.search).has('recognize') ? 'drafts' : 'evidence');
  const [info, setInfo] = useState(null);
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [range, setRange] = useState('90');
  const [from, setFrom] = useState(isoDay(Date.now() - 89 * 864e5));
  const [to, setTo] = useState(isoDay(Date.now()));
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);

  const load = () => {
    api.get('/career').then(setInfo).catch(() => {});
    api.get('/career/evidence').then(setItems).catch(e => notify(e.message));
    api.get('/career/drafts').then(setDrafts).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const suggested = items.filter(i => i.status === 'suggested');
  const kept = items.filter(i => i.status === 'confirmed');
  const byTheme = useMemo(() => {
    const m = new Map();
    for (const i of kept) { if (!m.has(i.theme)) m.set(i.theme, []); m.get(i.theme).push(i); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [kept]);

  function chooseRange(r) {
    setRange(r.k);
    if (r.days) { setFrom(isoDay(Date.now() - (r.days - 1) * 864e5)); setTo(isoDay(Date.now())); }
  }

  async function combine() {
    setBusy('combine');
    try {
      const r = await api.post('/career/evidence/combine');
      notify(`Combined ${r.combined} small items into ${r.created} bigger one${r.created === 1 ? '' : 's'}`);
      load();
    } catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }

  async function find() {
    setBusy('find');
    try {
      const r = await api.post('/career/evidence/extract', {
        from_iso: new Date(`${from}T00:00:00`).toISOString(), to_iso: new Date(`${to}T23:59:59.999`).toISOString()
      });
      notify(r.added ? `Found ${r.added} new item${r.added > 1 ? 's' : ''} in ${r.scanned} entries` : `Nothing new in ${r.scanned} entries`);
      load();
    } catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }

  async function patch(id, body) {
    try {
      const next = await api.patch(`/career/evidence/${id}`, body);
      setItems(list => list.map(i => (i.id === id ? next : i)).filter(i => i.status !== 'dismissed'));
    } catch (e) { notify(e.message); }
  }

  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <main className="page">
      <ReflectNav />
      <div className="topbar">
        <h1>Career record</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>A private record of your own work, pulled from your journal and confirmed by you. Use it to draft portfolio stories, resume updates and LinkedIn posts. Nothing leaves Heartwood unless you export or copy it.</p>

      <div className="seg mb" role="tablist" aria-label="Career record">
        <button role="tab" aria-selected={tab === 'evidence'} className={tab === 'evidence' ? 'on' : ''} onClick={() => setTab('evidence')}>Evidence{suggested.length ? ` (${suggested.length} new)` : ''}</button>
        <button role="tab" aria-selected={tab === 'drafts'} className={tab === 'drafts' ? 'on' : ''} onClick={() => setTab('drafts')}>Drafts</button>
      </div>

      {tab === 'evidence' && <>
        <section className="card">
          <div className="analysis-head"><Icon name="search" /><h2>Find evidence</h2></div>
          <p className="small muted" style={{ marginTop: 0 }}>Reads your entries for the initiatives you led, the outcomes they produced, how you show up as a leader, big decisions, feedback you got and what you learned. Only about you, never assessments of anyone else.</p>
          <div className="field"><span>Period</span>
            <div className="seg">{RANGES.map(r => <button key={r.k} aria-pressed={range === r.k} className={range === r.k ? 'on' : ''} onClick={() => chooseRange(r)}>{r.label}</button>)}</div>
          </div>
          {range === 'custom' && (
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span>From</span><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label className="field" style={{ flex: 1 }}><span>To</span><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
            </div>
          )}
          <button className="btn primary block" onClick={find} disabled={!!busy}>
            {busy === 'find' ? <><span className="spinner" /> Reading your journal…</> : <><Icon name="sparkle" size={18} /> Find evidence</>}
          </button>
          <button className="btn ghost block mt" onClick={() => setAdding(a => !a)} aria-expanded={adding}><Icon name="plus" size={18} /> Add your own</button>
          {adding && <AddEvidence themes={info?.themes || []} onAdded={item => { setItems(l => [item, ...l]); setAdding(false); notify('Added to your record'); }} />}
        </section>

        {suggested.length > 0 && <>
          <h2 className="section-title">New suggestions</h2>
          <p className="small muted" style={{ marginTop: -4 }}>Keep what’s accurate, fix what’s close, dismiss the rest. Only kept items are used in drafts.</p>
          {suggested.length >= 3 && (
            <div className="banner info" style={{ marginBottom: 10 }}>
              <span className="grow small">Too many small items? Combine them into the initiatives, outcomes and leadership patterns they add up to. Items you’ve kept aren’t touched.</span>
              <button className="btn small" onClick={combine} disabled={!!busy}>{busy === 'combine' ? <><span className="spinner" /> Combining…</> : 'Combine'}</button>
            </div>
          )}
          {suggested.map(i => <EvidenceItem key={i.id} item={i} themes={info?.themes || []} onPatch={patch} suggested />)}
        </>}

        <h2 className="section-title">Your record{kept.length ? ` (${kept.length})` : ''}</h2>
        {!kept.length && <p className="muted small">Nothing kept yet. Find evidence above or add your own.</p>}
        {kept.length > 0 && <p className="small muted" style={{ marginTop: -4 }}>Select items to build a draft from just those. With nothing selected, drafts use everything you’ve kept.</p>}
        {byTheme.map(([theme, list]) => (
          <div key={theme}>
            <div className="day-label">{theme}</div>
            {list.map(i => <EvidenceItem key={i.id} item={i} themes={info?.themes || []} onPatch={patch} selected={selected.has(i.id)} onSelect={() => toggle(i.id)} />)}
          </div>
        ))}
      </>}

      {tab === 'drafts' && <Drafts info={info} drafts={drafts} people={people} selected={[...selected]} initial={Object.fromEntries(new URLSearchParams(loc.search))} />}
    </main>
  );
}

function EvidenceItem({ item, themes, onPatch, suggested, selected, onSelect }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(item.text);
  const [theme, setTheme] = useState(item.theme);
  const [metric, setMetric] = useState(item.metric);
  const save = async status => { await onPatch(item.id, { text, theme, metric, ...(status ? { status } : {}) }); setEdit(false); };

  return (
    <article className={`card evidence${selected ? ' selected' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {onSelect && (
          <input type="checkbox" className="evidence-check" checked={!!selected} onChange={onSelect}
            aria-label={`Use in a draft: ${item.text}`} />
        )}
        <div className="grow">
          <div className="evidence-meta small muted">
            <span className="chip" style={{ fontSize: 12, padding: '1px 8px' }}>{KIND[item.kind] || item.kind}</span>
            {item.date && <span>{formatDate(`${item.date}T12:00`)}</span>}
            {item.metric && <span className="evidence-metric">{item.metric}</span>}
          </div>
          {edit ? <>
            <label className="field mt"><span>What you did</span><textarea className="textarea" value={text} onChange={e => setText(e.target.value)} /></label>
            <div className="row">
              <label className="field grow"><span>Theme</span>
                <select className="select" value={theme} onChange={e => setTheme(e.target.value)}>{themes.map(t => <option key={t}>{t}</option>)}</select>
              </label>
              <label className="field grow"><span>Number <small>(only if real)</small></span><input className="input" value={metric} onChange={e => setMetric(e.target.value)} /></label>
            </div>
          </> : <p className="evidence-text">{item.text}</p>}
          {!edit && item.detail && <p className="small muted" style={{ margin: '4px 0 0' }}>{item.detail}</p>}
          {item.entries?.length > 0 && (
            <p className="small" style={{ margin: '6px 0 0' }}>From {item.entries.map((e, n) => <span key={e.id}>{n > 0 && ', '}<Link to={`/entry/${e.id}`}>{e.title || formatDate(e.created_at)}</Link></span>)}</p>
          )}
          <label className="row small mt" style={{ gap: 8 }}>
            <input type="checkbox" checked={item.public_ok} onChange={e => onPatch(item.id, { public_ok: e.target.checked })} />
            OK to use publicly, after names are removed
          </label>
        </div>
      </div>
      <div className="row mt" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {edit ? <>
          <button className="btn small ghost" onClick={() => { setEdit(false); setText(item.text); setTheme(item.theme); setMetric(item.metric); }}>Cancel</button>
          <button className="btn small primary" onClick={() => save(suggested ? 'confirmed' : null)}>{suggested ? 'Save and keep' : 'Save'}</button>
        </> : <>
          <button className="btn small ghost" onClick={() => onPatch(item.id, { status: 'dismissed' })}>{suggested ? 'Dismiss' : 'Remove'}</button>
          <button className="btn small" onClick={() => setEdit(true)}>Edit</button>
          {suggested && <button className="btn small primary" onClick={() => onPatch(item.id, { status: 'confirmed' })}><Icon name="check" size={16} /> Keep</button>}
        </>}
      </div>
    </article>
  );
}

function AddEvidence({ themes, onAdded }) {
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [theme, setTheme] = useState('Other');
  const [metric, setMetric] = useState('');
  const [date, setDate] = useState(isoDay(Date.now()));
  async function add() {
    try { onAdded(await api.post('/career/evidence', { text, theme, metric, date })); }
    catch (e) { notify(e.message); }
  }
  return (
    <div className="mt">
      <label className="field"><span>What you did</span><textarea className="textarea" value={text} onChange={e => setText(e.target.value)} placeholder="One sentence, in your words. For example: Negotiated a new research tool contract that cut cost per participant." /></label>
      <div className="row">
        <label className="field grow"><span>Theme</span><select className="select" value={theme} onChange={e => setTheme(e.target.value)}>{themes.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="field grow"><span>When</span><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <label className="field"><span>Number <small>(optional)</small></span><input className="input" value={metric} onChange={e => setMetric(e.target.value)} /></label>
      <button className="btn primary block" onClick={add} disabled={!text.trim()}>Add to record</button>
    </div>
  );
}

function Drafts({ info, drafts, people, selected, initial = {} }) {
  const nav = useNavigate();
  const { notify } = useApp();
  // Opened from a person's page or a win in their growth record: ?recognize=<person id>&win=<text>
  const [kind, setKind] = useState(initial.recognize ? 'recognition' : 'story');
  const [angle, setAngle] = useState('');
  const [current, setCurrent] = useState('');
  const [personId, setPersonId] = useState(initial.recognize || '');
  const [win, setWin] = useState(initial.win || '');
  const [wins, setWins] = useState([]);
  const [busy, setBusy] = useState(false);
  const gh = info?.github;
  const team = people.filter(p => p.relationship === 'direct_report').concat(people.filter(p => p.relationship !== 'direct_report'));

  useEffect(() => {
    setWins([]);
    if (!personId) return;
    api.get(`/people/${personId}/growth`).then(g => setWins((g?.timeline || []).filter(t => t.type === 'win' || t.type === 'milestone').slice(-6).reverse())).catch(() => {});
  }, [personId]);

  async function create() {
    setBusy(true);
    try {
      const d = await api.post('/career/drafts', { kind, angle, current, evidence_ids: selected, person_id: personId, win });
      nav(`/career/drafts/${d.id}`);
    } catch (e) { notify(e.message); setBusy(false); }
  }
  const needsGitHub = kind === 'resume' && !gh?.ready;
  const def = DRAFTS.find(d => d.k === kind);

  return <>
    {gh && !gh.ready && (
      <div className="banner info"><Icon name="key" size={18} /><span className="grow">To export stories and resume updates to your portfolio, {gh.token ? 'set your portfolio repository' : 'add GITHUB_TOKEN to .env and set your portfolio repository'} in <Link to="/settings/career" state={{ from: 'here' }}>Settings</Link>.</span></div>
    )}
    <section className="card">
      <div className="analysis-head"><Icon name="note" /><h2>New draft</h2></div>
      <div className="seg mb">{DRAFTS.map(d => <button key={d.k} aria-pressed={kind === d.k} className={kind === d.k ? 'on' : ''} onClick={() => setKind(d.k)}>{d.label}</button>)}</div>
      <p className="small muted" style={{ marginTop: 0 }}>{def.hint}</p>
      {kind !== 'recognition' && <p className="small" style={{ marginTop: 0 }}>{selected.length ? `Uses the ${selected.length} item${selected.length > 1 ? 's' : ''} you selected.` : 'Uses everything in your record.'}</p>}
      {kind === 'story' && (
        <label className="field"><span>Angle <small>(optional)</small></span><input className="input" value={angle} onChange={e => setAngle(e.target.value)} placeholder="For example: how we made research faster" /></label>
      )}
      {kind === 'linkedin' && (
        <label className="field"><span>Your current LinkedIn headline and About <small>(optional, for comparison)</small></span><textarea className="textarea" value={current} onChange={e => setCurrent(e.target.value)} /></label>
      )}
      {kind === 'recognition' && <>
        <label className="field"><span>Who</span>
          <select className="select" value={personId} onChange={e => setPersonId(e.target.value)}>
            <option value="">Choose someone</option>
            {team.map(p => <option key={p.id} value={p.id}>{p.name}{p.role ? `, ${p.role}` : ''}</option>)}
          </select>
        </label>
        {wins.length > 0 && <>
          <div className="small muted" style={{ marginBottom: 6 }}>Recent wins from their growth record</div>
          <div className="chips mb">{wins.map((w, i) => <button key={i} className="chip" onClick={() => setWin(w.text)}>{w.text.length > 70 ? `${w.text.slice(0, 70)}…` : w.text}</button>)}</div>
        </>}
        <label className="field"><span>What you want to recognize</span><textarea className="textarea" value={win} onChange={e => setWin(e.target.value)} placeholder="What they did and why it mattered" /></label>
      </>}
      <button className="btn primary block" onClick={create} disabled={busy || needsGitHub || (kind === 'recognition' && (!personId || !win.trim()))}>
        {busy ? <><span className="spinner" /> Writing…</> : <><Icon name="sparkle" size={18} /> Write draft</>}
      </button>
      {needsGitHub && <p className="small muted">Resume updates read your career record from your portfolio repo, so set that up first.</p>}
    </section>

    {drafts.length > 0 && <>
      <h2 className="day-label">Past drafts</h2>
      {drafts.map(d => (
        <Link key={d.id} to={`/career/drafts/${d.id}`} className="entry-item">
          <h3>{d.title}</h3>
          <div className="entry-meta" style={{ marginTop: 2 }}>
            <span>{DRAFTS.find(x => x.k === d.kind)?.label || d.kind}</span>
            <span className="dot">{d.status === 'exported' ? 'Pull request opened' : 'Draft'}</span>
            <span className="dot">{formatDate(d.created_at)}</span>
          </div>
        </Link>
      ))}
    </>}
  </>;
}
