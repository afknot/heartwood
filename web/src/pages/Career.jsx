import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ReflectNav from '../components/ReflectNav.jsx';
import { VoiceTextarea } from '../components/VoiceInput.jsx';
import { deletingDrafts } from './CareerDraft.jsx';
import { useApp } from '../lib/context.js';
import { formatDate, isoDay } from '../lib/format.js';

const RANGES = [
  { k: '30', label: 'Past month', days: 30 },
  { k: '90', label: 'Past quarter', days: 90 },
  { k: '182', label: 'Past 6 months', days: 182 },
  { k: '365', label: 'Past year', days: 365 },
  { k: 'custom', label: 'Custom' }
];
const KIND = { initiative: 'Initiative', outcome: 'Outcome', leadership: 'Leadership', decision: 'Decision', feedback: 'Feedback', learning: 'Learning', result: 'Outcome', built: 'Initiative' };
const DRAFTS = [
  { k: 'story', label: 'Story', hint: 'A leadership story for your portfolio, in the sections and format you set in Settings. Copy it, download it as Markdown, or export it as a pull request.' },
  { k: 'review', label: 'Review', hint: 'Your self-review for a performance cycle: wins, how you led, how you grew and what’s next, or the headings you set in Settings (your company’s competencies, say). Built from your record for that period. Copy it or download it.' },
  { k: 'resume', label: 'Resume', hint: 'Suggested lines to add to your resume, or stronger versions of the ones there. Paste or upload your resume and copy the lines you keep. With a portfolio repository connected, they can go in as a pull request instead.' },
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

  // Your record as Markdown, grouped by theme, for a review doc, a promotion case or your own files.
  const recordMd = () => ['# Career record', '', ...byTheme.flatMap(([theme, list]) => [`## ${theme}`, '', ...list.map(i =>
    `- ${i.text}${i.metric ? ` (${i.metric})` : ''}${i.date ? ` _${i.date}_` : ''}${i.detail ? `\n  ${i.detail}` : ''}`), ''])].join('\n');
  async function copyRecord() {
    try { await navigator.clipboard.writeText(recordMd()); notify('Copied your record'); }
    catch { notify('Couldn’t copy. Use Download instead.'); }
  }
  function downloadRecord() {
    const url = URL.createObjectURL(new Blob([recordMd()], { type: 'text/markdown' }));
    Object.assign(document.createElement('a'), { href: url, download: `career-record-${isoDay(Date.now())}.md` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function markPublic(on) {
    const ids = kept.filter(i => selected.has(i.id) && i.public_ok !== on).map(i => i.id);
    for (const id of ids) await patch(id, { public_ok: on });
    notify(ids.length ? `${ids.length} item${ids.length > 1 ? 's' : ''} ${on ? 'marked OK to share publicly' : 'marked not public'}` : 'Already set');
  }

  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <main className="page">
      <ReflectNav />
      <div className="topbar">
        <h1>Career record</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>A private record of your own work, pulled from your journal and confirmed by you. Use it to draft portfolio stories, self-reviews, resume updates and LinkedIn posts. Nothing leaves Heartwood unless you export or copy it.</p>

      <div className="seg mb" role="group" aria-label="Show">
        <button aria-pressed={tab === 'evidence'} className={tab === 'evidence' ? 'on' : ''} onClick={() => setTab('evidence')}>Evidence{suggested.length ? ` (${suggested.length} new)` : ''}</button>
        <button aria-pressed={tab === 'drafts'} className={tab === 'drafts' ? 'on' : ''} onClick={() => setTab('drafts')}>Drafts</button>
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

        <div className="row section-title-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 className="section-title grow">Your record{kept.length ? ` (${kept.length})` : ''}</h2>
          {kept.length > 0 && <>
            <button className="btn small ghost" onClick={copyRecord}><Icon name="clip" size={16} /> Copy</button>
            <button className="btn small ghost" onClick={downloadRecord}><Icon name="note" size={16} /> Download .md</button>
          </>}
        </div>
        {!kept.length && <p className="muted small">Nothing kept yet. Find evidence above or add your own.</p>}
        {kept.length > 0 && <p className="small muted" style={{ marginTop: -4 }}>Select items to build a draft from just those. With nothing selected, drafts use everything you’ve kept.</p>}
        {selected.size > 0 && (
          <div className="banner info select-bar" role="region" aria-label="Selected items">
            <span className="grow small">{selected.size} selected</span>
            <button className="btn small" onClick={() => markPublic(true)}>Mark OK to share publicly</button>
            <button className="btn small ghost" onClick={() => markPublic(false)}>Not public</button>
            <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
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
      <div className="field"><span>What you did</span>
        <VoiceTextarea value={text} onChange={setText} rows={3} label="What you did" placeholder="One sentence, in your words, or tap the mic and say it. For example: Negotiated a new research tool contract that cut cost per participant." />
      </div>
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
  const [resumeText, setResumeText] = useState('');
  const [period, setPeriod] = useState('182');
  const [pFrom, setPFrom] = useState(isoDay(Date.now() - 181 * 864e5));
  const [pTo, setPTo] = useState(isoDay(Date.now()));
  const choosePeriod = r => { setPeriod(r.k); if (r.days) { setPFrom(isoDay(Date.now() - (r.days - 1) * 864e5)); setPTo(isoDay(Date.now())); } };
  const [reading, setReading] = useState(false);
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
      const d = await api.post('/career/drafts', { kind, angle, current, evidence_ids: selected, person_id: personId, win, resume_text: kind === 'resume' && !gh?.ready ? resumeText : '', from: pFrom, to: pTo });
      nav(`/career/drafts/${d.id}`);
    } catch (e) { notify(e.message); setBusy(false); }
  }
  const pasting = kind === 'resume' && gh && !gh.ready;
  const needsResume = pasting && resumeText.trim().length < 80 && !info?.has_resume;
  async function readFile(file) {
    if (!file) return;
    setReading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/career/resume-file', { method: 'POST', body: form, credentials: 'same-origin' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Couldn’t read that file.');
      setResumeText(j.text);
      notify('Read your resume. Check it below, then write the draft.');
    } catch (e) { notify(e.message); }
    finally { setReading(false); }
  }
  const def = DRAFTS.find(d => d.k === kind);
  const hint = kind === 'linkedin' && info?.job_status === 'open'
    ? 'A headline, About section, experience bullets and post ideas to paste into LinkedIn yourself. You said you’re looking openly, so they can say so.'
    : def.hint;
  const linksSet = !!(info?.links?.linkedin || info?.links?.portfolio);
  const [hideSetup, setHideSetup] = useState(() => { try { return localStorage.getItem('hw:career-setup-hidden') === '1'; } catch { return false; } });
  const dismissSetup = () => { setHideSetup(true); try { localStorage.setItem('hw:career-setup-hidden', '1'); } catch { /* fine */ } };

  return <>
    {gh && !gh.ready && !linksSet && !hideSetup && (
      <div className="banner info"><Icon name="key" size={18} /><span className="grow">Stories work as they are: copy them or download Markdown. In <Link to="/settings/career" state={{ from: 'here' }}>Settings</Link> you can add your LinkedIn and portfolio links, choose a story format, or connect GitHub for pull requests.</span>
        <button className="btn small ghost" onClick={dismissSetup}>Hide</button></div>
    )}
    <section className="card">
      <div className="analysis-head"><Icon name="note" /><h2>New draft</h2></div>
      <div className="seg mb">{DRAFTS.map(d => <button key={d.k} aria-pressed={kind === d.k} className={kind === d.k ? 'on' : ''} onClick={() => setKind(d.k)}>{d.label}</button>)}</div>
      <p className="small muted" style={{ marginTop: 0 }}>{hint}</p>
      {kind !== 'recognition' && <p className="small" style={{ marginTop: 0 }}>{selected.length ? `Uses the ${selected.length} item${selected.length > 1 ? 's' : ''} you selected.` : kind === 'review' ? 'Uses everything in your record from the period you pick.' : 'Uses everything in your record.'}</p>}
      {kind === 'review' && <>
        <div className="field"><span>Period</span>
          <div className="seg">{RANGES.filter(r => r.k !== '30').map(r => <button key={r.k} aria-pressed={period === r.k} className={period === r.k ? 'on' : ''} onClick={() => choosePeriod(r)}>{r.label}</button>)}</div>
        </div>
        {period === 'custom' && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>From</span><input className="input" type="date" value={pFrom} onChange={e => setPFrom(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>To</span><input className="input" type="date" value={pTo} onChange={e => setPTo(e.target.value)} /></label>
          </div>
        )}
        <div className="field"><span>What to emphasize <small>(optional)</small></span><VoiceTextarea value={angle} onChange={setAngle} rows={2} label="What to emphasize" placeholder="For example: going for promotion to senior manager, so show scope" /></div>
      </>}
      {kind === 'story' && (
        <div className="field"><span>Angle <small>(optional)</small></span><VoiceTextarea value={angle} onChange={setAngle} rows={2} label="Angle" placeholder="For example: how we made research faster" /></div>
      )}
      {pasting && <>
        <div className="field"><span>Your current resume</span>
          <textarea className="textarea" rows={8} value={resumeText} onChange={e => setResumeText(e.target.value)} aria-label="Your current resume"
            placeholder={info?.has_resume ? 'Leave empty to use the resume you pasted last time, or paste a newer one.' : 'Paste your resume here, or upload it below.'} />
        </div>
        <div className="row mb" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="btn small">
            {reading ? <><span className="spinner" /> Reading…</> : <><Icon name="clip" size={16} /> Upload Word, PDF or JSON Resume</>}
            <input type="file" accept=".docx,.pdf,.txt,.md,.json" hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="small muted grow">It stays in Heartwood, with this draft. Only the AI provider you chose reads it.</span>
        </div>
      </>}
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
        <div className="field"><span>What you want to recognize</span><VoiceTextarea value={win} onChange={setWin} rows={3} label="What you want to recognize" placeholder="What they did and why it mattered" /></div>
      </>}
      <button className="btn primary block" onClick={create} disabled={busy || reading || needsResume || (kind === 'recognition' && (!personId || !win.trim()))}>
        {busy ? <><span className="spinner" /> Writing…</> : <><Icon name="sparkle" size={18} /> Write draft</>}
      </button>
      {needsResume && <p className="small muted">Add your resume above first, so the suggestions fit what’s already there.</p>}
    </section>

    {drafts.some(d => !deletingDrafts.has(d.id)) && <>
      <h2 className="day-label">Past drafts</h2>
      {drafts.filter(d => !deletingDrafts.has(d.id)).map(d => (
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
