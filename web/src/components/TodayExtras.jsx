import { safeHref } from '../lib/format.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { TeamThisWeek } from './TeamWeek.jsx';

const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
const plural = (n, one, many = `${one}s`) => `${n}\u00a0${n === 1 ? one : many}`;

/** A good moment from your own journal: looking back, praise you got, a win, someone to recognize. */
function Moment({ m }) {
  return (
    <div className="moment">
      <span className="eyebrow">{m.title}</span>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginTop: 4 }}>
        {m.person && <Avatar person={m.person} size={30} />}
        <p className="moment-text grow">{m.text}</p>
      </div>
      {m.action && <Link className="btn small" to={m.action.to}>{m.action.label}</Link>}
    </div>
  );
}

const KIND_LABEL = { practice: 'something to try', moment: 'a good moment', quote: 'a thought for today' };

/** The top of Today: one thing, picked for the moment you're in (see topPick on the server). */
export function PracticeCard({ practice, moment, top, onChange, notify }) {
  const [p, setP] = useState(practice);
  const [busy, setBusy] = useState(false);
  const kinds = [p && 'practice', moment && 'moment', p?.quote && 'quote'].filter(Boolean);
  const [show, setShow] = useState(kinds.includes(top) ? top : kinds[0]);
  if (!kinds.length) return null;
  const act = async (url, body) => {
    setBusy(true);
    try { const next = await api.post(url, body); setP(next); onChange?.(next); }
    catch (e) { notify?.(e.message); }
    finally { setBusy(false); }
  };
  const next = kinds[(kinds.indexOf(show) + 1) % kinds.length];
  const where = p?.try_in && `${timeOf(p.try_in.start)} · ${p.try_in.event_title || p.try_in.people.map(x => x.name.split(' ')[0]).join(', ')}`;
  return (
    <section className={`card practice-card${show === 'practice' && p?.done_at ? ' is-done' : ''}`} aria-label={KIND_LABEL[show].replace(/^./, c => c.toUpperCase())} aria-live="polite">
      {show === 'practice' && <>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <span className="practice-ic" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
          <span className="eyebrow grow">Something to try</span>
          {!p.done_at && <button className="btn ghost small" disabled={busy} onClick={() => act('/practice/another')}><Icon name="retry" size={14} /> Another</button>}
        </div>
        <h2 className="practice-title">{p.title}</h2>
        {!p.done_at && p.fits?.length > 0 && <span className="practice-fits">Fits: {p.fits.join(' · ')}</span>}
        {!p.done_at && <>
          <p className="practice-how">{p.how}</p>
          {where && <p className="small muted" style={{ margin: '0 0 10px' }}>Try it in: {where}</p>}
        </>}
        <div className="row wrap" style={{ gap: 8 }}>
          {p.done_at ? <>
            <span className="practice-done"><Icon name="check" size={16} /> Tried today. It’s part of this week’s ring.</span>
            <button className="btn ghost small" disabled={busy} onClick={() => act('/practice/done', { done: false })}>Undo</button>
          </> : (
            <button className="btn small primary" disabled={busy} onClick={() => act('/practice/done', { done: true })}><Icon name="check" size={16} /> I tried it</button>
          )}
        </div>
        {!p.done_at && <p className="practice-source">Inspired by {p.source}</p>}
      </>}
      {show === 'moment' && <Moment m={moment} />}
      {show === 'quote' && (
        <figure className="practice-quote is-alone" style={{ marginInline: 0 }}>
          <span className="eyebrow">A thought for today</span>
          <q>{p.quote.text}</q>
          <cite>{p.quote.who}, {safeHref(p.quote.url) ? <a href={safeHref(p.quote.url)} target="_blank" rel="noopener noreferrer">{p.quote.work}</a> : p.quote.work}</cite>
          {p.quote.ai && <small className="muted" style={{ display: 'block', marginTop: 4 }}>Picked by AI from your inspiration. Check it before you share it.</small>}
        </figure>
      )}
      {kinds.length > 1 && (
        <button type="button" className="linklike small top-next" onClick={() => setShow(next)}>Something else: {KIND_LABEL[next]}</button>
      )}
    </section>
  );
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const RADII = [0, 36, 54, 72, 90]; // Monday is the heartwood dot; Tuesday to Friday the rings around it

/**
 * A week as five marks: Monday the dot at the center, Tuesday to Friday the rings around it.
 * Done days are solid (thicker the more you did; a quiet day is a fine line), today is dashed,
 * days ahead are faint outlines. `today` is null for a finished week.
 */
export function FiveRings({ days = [0, 0, 0, 0, 0], today = null, past = false, size = 96, label }) {
  const status = d => (today === null || d < today ? 'done' : d === today ? 'today' : 'ahead');
  const thick = n => Math.min(4, n) * 2.2;
  const marks = [4, 3, 2, 1, 0].map(d => {
    const n = days[d] || 0;
    // Today fills in as you go: solid (and gently pulsing) once you've done something.
    const raw = status(d);
    const st = raw === 'today' && n ? 'done' : raw;
    const cls = `fr-${st}${st === 'done' && !n ? ' fr-quiet' : ''}${raw === 'today' && n ? ' fr-now' : ''}${past ? ' fr-past' : ''}`;
    if (d === 0) {
      if (st === 'done' && n) return <circle key={d} cx="100" cy="100" r={9 + thick(n)} className={`fr-dot ${cls}`} />;
      return <circle key={d} cx="100" cy="100" r={st === 'done' ? 6 : 14} className={`fr-ring ${cls}`} />;
    }
    return <circle key={d} cx="100" cy="100" r={RADII[d]} className={`fr-ring ${cls}`} style={st === 'done' && n ? { strokeWidth: 3 + thick(n) } : undefined} />;
  });
  const sum = days.reduce((a, b) => a + b, 0);
  return (
    <svg className="five-rings" width={size} height={size} viewBox="0 0 200 200" role="img"
      aria-label={label || (today === null ? `${plural(sum, 'thing')} that week` : `${DAY_NAMES[today]}: ${plural(sum, 'thing')} so far this week`)}>
      {marks}
    </svg>
  );
}

function weekSummary(t) {
  if (!t) return '';
  const parts = [
    t.conversations && plural(t.conversations, 'conversation'),
    t.notes && plural(t.notes, 'note'),
    t.reflections && plural(t.reflections, 'reflection'),
    t.followups && `${plural(t.followups, 'follow-up')}\u00a0closed`,
    t.kudos && plural(t.kudos, 'kudos', 'kudos'),
    t.practices && `${plural(t.practices, 'practice')}\u00a0tried`
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Your week: five rings that fill in Monday to Friday, and who on your team you've had time with. */
export function WeekCard({ rings, coverage, onChanged }) {
  const [explain, setExplain] = useState(false);
  const [history, setHistory] = useState(false);
  const team = coverage?.people || [];
  if (!rings && !team.length) return null;
  const summary = weekSummary(rings?.this_week);
  const past = (rings?.weeks || []).slice(0, -1).slice(-10);
  const weekLabel = w => new Date(`${w}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <section className="card week-card" aria-labelledby="week-title">
      {rings && (
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <button type="button" className="rings-btn" onClick={() => setExplain(!explain)} aria-expanded={explain} aria-controls="rings-help" aria-label="What the rings mean">
            <FiveRings days={rings.this_week?.days} today={rings.today ?? 0} />
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 id="week-title" className="week-title">Your week</h2>
            <p className="small" style={{ margin: '2px 0 0' }}>{summary || 'A fresh week. Monday is the center; each day adds a ring.'}</p>
            {past.length > 0 && <button type="button" className="linklike small top-next" style={{ marginTop: 4 }} onClick={() => setHistory(!history)} aria-expanded={history}>{history ? 'Hide past weeks' : 'Past weeks'}</button>}
          </div>
        </div>
      )}
      {explain && (
        <p id="rings-help" className="small muted" style={{ margin: '10px 0 0' }}>
          Monday is the dot at the center; Tuesday to Friday are the rings around it (weekends count toward Friday). Conversations, notes, reflections, closed follow-ups, kudos and practices make a day’s mark thicker. A quiet day is a fine line, never a gap.
        </p>
      )}
      {history && past.length > 0 && (
        <ul className="past-weeks" aria-label="Past weeks">
          {past.map((w, i) => (
            <li key={w.week}>
              <FiveRings days={w.days} past={i !== past.length - 1} size={48} label={`Week of ${weekLabel(w.week)}: ${plural(w.days.reduce((a, b) => a + b, 0), 'thing')}`} />
              <span>{weekLabel(w.week)}</span>
            </li>
          ))}
        </ul>
      )}
      <TeamThisWeek coverage={coverage} onChanged={onChanged} embedded={!!rings} />
    </section>
  );
}
