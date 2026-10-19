import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import Sheet from './Sheet.jsx';
import { PrepSheet } from './Followups.jsx';

export const READS = [
  { k: 'good', label: 'Good' },
  { k: 'okay', label: 'Okay' },
  { k: 'carrying', label: 'Carrying something' }
];
const SHORT = { good: 'Good', okay: 'Okay', carrying: 'Carrying' };
const first = p => p.name.split(' ')[0];

/** "How did Sam seem?" Three big choices and an optional word on why. Your read, private to you. */
export function HowDidTheySeem({ person, context, onSaved, onSkip, compact = false }) {
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(read = pick) {
    if (!read) return;
    setBusy(true);
    try { await api.post(`/team/${person.id}/read`, { read, note }); onSaved?.(read); }
    finally { setBusy(false); }
  }
  return (
    <div className="seem" role="group" aria-labelledby={`seem-${person.id}`}>
      <div className="row" style={{ gap: 10 }}>
        <Avatar person={person} size={compact ? 30 : 36} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div id={`seem-${person.id}`} className="seem-q">How did {first(person)} seem?</div>
          {context && <div className="small muted">{context}</div>}
        </div>
        {onSkip && <button type="button" className="btn ghost small" onClick={onSkip}>Skip</button>}
      </div>
      <div className="seem-choices">
        {READS.map(r => (
          <button key={r.k} type="button" className={`seem-choice seem-${r.k}${pick === r.k ? ' on' : ''}`} aria-pressed={pick === r.k} disabled={busy}
            onClick={() => (pick === r.k ? save(r.k) : setPick(r.k))}>{r.label}</button>
        ))}
      </div>
      {pick && (
        <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); save(); }}>
          <input className="input grow" value={note} onChange={e => setNote(e.target.value)} placeholder="A word on why (optional)" aria-label="A word on why (optional)" maxLength={200} />
          <button className="btn small primary" disabled={busy}>Save</button>
        </form>
      )}
    </div>
  );
}

/** Why someone might need you, and what to do about it. */
function NeedsSheet({ person, onClose, onChanged }) {
  const [prep, setPrep] = useState(null); // 'prep' | 'agenda'
  if (!person) return null;
  async function dismiss() { await api.post(`/team/${person.id}/dismiss`); onChanged?.(); onClose(); }
  const rhythm = person.rhythm > 1 ? `Every ${person.rhythm} weeks` : 'Weekly';
  return <>
    <Sheet open={!!person && !prep} onClose={onClose} title={person.headline || `${first(person)} might need you`}>
      <p className="small muted" style={{ marginTop: -8 }}>{rhythm}{person.read ? ` · last seemed ${SHORT[person.read].toLowerCase()}` : ''}</p>
      <h3 className="eyebrow" style={{ margin: '4px 0 6px' }}>Why</h3>
      <ul className="needs-why">{person.needs.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {person.steps.length > 0 && <>
        <h3 className="eyebrow" style={{ margin: '14px 0 6px' }}>Something to try</h3>
        <div className="stack" style={{ gap: 8 }}>
          {person.steps.map((s, i) => s.kind === 'kudos'
            ? <Link key={i} className="needs-step" to={`/career?recognize=${person.id}#drafts`} onClick={onClose}>{s.label}<Icon name="chevron" size={16} /></Link>
            : s.kind === 'followup'
              ? <Link key={i} className="needs-step" to={`/people/${person.id}`} onClick={onClose}>{s.label}<Icon name="chevron" size={16} /></Link>
              : <button key={i} type="button" className="needs-step" onClick={() => setPrep(s.kind === 'agenda' ? 'agenda' : 'prep')}>{s.label}<Icon name="chevron" size={16} /></button>)}
        </div>
      </>}
      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        <button className="btn grow" onClick={dismiss}>{person.pronouns?.startsWith('she') ? 'She’s' : person.pronouns?.startsWith('he/') ? 'He’s' : 'They’re'} fine, dismiss</button>
        <Link className="btn grow" to={`/people/${person.id}`} onClick={onClose}>Open {first(person)}’s page</Link>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Built only from what you wrote and marked. Heartwood never guesses anyone’s feelings.</p>
    </Sheet>
    <PrepSheet open={!!prep} initialTab={prep || 'prep'} onClose={() => { setPrep(null); onClose(); }} person={person} event={null} />
  </>;
}

/** Your team this week: who you've seen, how they seemed to you, and who might need you. */
export function TeamThisWeek({ coverage, onChanged, embedded = true }) {
  const [asked, setAsked] = useState([]); // ids answered or skipped here
  const [open, setOpen] = useState(null);
  const team = coverage?.people || [];
  useEffect(() => { setAsked([]); }, [coverage?.today]);
  if (!team.length) return null;
  const onRhythm = team.filter(p => p.on_rhythm).length;
  const seenCount = team.filter(p => p.covered).length;
  const needing = team.filter(p => p.needs?.length);
  const ask = (coverage.ask || []).filter(a => !asked.includes(a.id));
  // Not seen yet: when you'll see them (from your 1:1s and calendar), else whether they're on rhythm.
  const day = iso => new Date(iso).toLocaleDateString([], { weekday: 'short' });
  const status = p => (p.covered ? (p.read ? SHORT[p.read] : 'Seen')
    : p.next_this_week ? day(p.next_at)
      : p.next_at ? 'Next week'
        : p.on_rhythm ? 'On rhythm' : 'Not yet');
  return (
    <div className="coverage" style={embedded ? undefined : { borderTop: 0, marginTop: 0, paddingTop: 0 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="eyebrow grow">Your team this week</span>
        <span className="small muted">{seenCount ? `${seenCount} of ${team.length} seen` : onRhythm === team.length ? 'Everyone on rhythm' : `${team.length - onRhythm} overdue`}</span>
      </div>
      {ask[0] && (
        <HowDidTheySeem key={ask[0].id} person={ask[0]} context={`${ask[0].event_title || '1:1'} · today`}
          onSaved={() => { setAsked(a => [...a, ask[0].id]); onChanged?.(); }} onSkip={() => setAsked(a => [...a, ask[0].id])} compact />
      )}
      <ul className="coverage-row">
        {team.map(p => {
          const needs = p.needs?.length > 0;
          const label = `${p.name}: ${p.covered ? `seen this week${p.read ? `, seemed ${READS.find(r => r.k === p.read).label.toLowerCase()}` : ''}` : p.next_at ? `next conversation ${new Date(p.next_at).toLocaleDateString([], { weekday: 'long' })}` : p.on_rhythm ? 'on rhythm' : 'not yet this week'}${needs ? `, ${(p.headline || 'might need you').replace(first(p) + ' ', '')}` : ''}`;
          const inner = <>
            <span className="coverage-avatar">
              <Avatar person={p} size={38} />
              {p.covered && <span className="coverage-check" aria-hidden="true"><Icon name="check" size={11} /></span>}
              {needs && <span className="coverage-needs" aria-hidden="true" />}
            </span>
            <span className="coverage-name">{first(p)}</span>
            <span className={`coverage-read${p.read ? ` read-${p.read}` : ''}`}>{status(p)}</span>
          </>;
          const cls = `coverage-person${p.covered ? ' is-covered' : ''}${p.on_rhythm && !p.covered ? ' is-rhythm' : ''}${p.read ? ` read-${p.read}` : ''}`;
          return (
            <li key={p.id}>
              {needs
                ? <button type="button" className={cls} aria-label={label} onClick={() => setOpen(p)}>{inner}</button>
                : <Link to={`/people/${p.id}`} className={cls} aria-label={label}>{inner}</Link>}
            </li>
          );
        })}
      </ul>
      {needing.length > 0 && (
        <ul className="needs-list">
          {needing.slice(0, 3).map(p => (
            <li key={p.id}>
              <button type="button" className="needs-line" onClick={() => setOpen(p)}>
                <span className="needs-dot" aria-hidden="true" />
                <span className="grow"><b>{p.headline || `${first(p)} might need you`}.</b> <span className="muted">{p.needs[0].replace(new RegExp(`^${first(p)}: `), '')}</span></span>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {team.some(p => p.read) && (
        <p className="read-legend"><span className="read-good">Good</span><span className="read-okay">Okay</span><span className="read-carrying">Carrying something</span><span>· your read, private to you</span></p>
      )}
      <NeedsSheet person={open} onClose={() => setOpen(null)} onChanged={onChanged} />
    </div>
  );
}

/** On a person's page: how they've seemed to you over the last 8 weeks, and a way to note today. */
export function ReadTrend({ person }) {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = () => api.get(`/team/${person.id}/reads`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [person.id]);
  if (!data) return null;
  const any = data.weeks.some(w => w.read);
  return (
    <section className="card mt" style={{ padding: '10px 16px 14px' }} aria-labelledby="trend-title">
      <div className="analysis-head"><Icon name="people" /><h2 id="trend-title" style={{ fontSize: 18 }}>How {first(person)} has seemed</h2>
        {!adding && <button className="btn ghost small" onClick={() => setAdding(true)}>Note today</button>}
      </div>
      {adding && <HowDidTheySeem person={person} onSaved={() => { setAdding(false); load(); }} onSkip={() => setAdding(false)} />}
      {any ? (
        <div className="read-trend" role="img" aria-label={`Last 8 weeks: ${data.weeks.map(w => w.read ? SHORT[w.read] : 'no note').join(', ')}`}>
          {data.weeks.map(w => (
            <div key={w.week} className="read-week" title={w.note || undefined}>
              <span className={`read-bar${w.read ? ` read-${w.read}` : ' read-none'}`} />
              <span className="small muted">{new Date(`${w.week}T12:00:00`).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}</span>
            </div>
          ))}
        </div>
      ) : !adding && <p className="small muted" style={{ margin: '4px 0 0' }}>After a conversation, note how {first(person)} seemed: Good, Okay or Carrying something. Over a few weeks you’ll see the trend here. It’s your read, private to you.</p>}
    </section>
  );
}
