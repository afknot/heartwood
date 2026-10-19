import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { useApp } from '../lib/context.js';
import { formatDate, renderMarkdown } from '../lib/format.js';

const TYPE = {
  win: { label: 'Win', color: 'var(--accent)' },
  milestone: { label: 'Milestone', color: 'var(--ink-2)' },
  goal: { label: 'Goal', color: 'var(--heartwood)' },
  feedback: { label: 'Feedback', color: 'var(--warn)' },
  concern: { label: 'Concern', color: 'var(--rec-text)' }
};
const STATUS = { active: 'In progress', achieved: 'Achieved', dropped: 'Dropped', unclear: 'Unclear' };
const FILTERS = [['all', 'All'], ['win', 'Wins'], ['feedback', 'Feedback'], ['concern', 'Concerns'], ['goal', 'Goals'], ['milestone', 'Milestones']];
const month = d => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });
const short = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

/**
 * A person's growth record over time: goals and where they stand, a dated timeline of wins, feedback,
 * concerns and milestones (each linked to the note it came from), and a review draft to start from.
 */
export default function Growth({ person, entryCount }) {
  const { notify } = useApp();
  const [g, setG] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const first = person.name.split(' ')[0];

  useEffect(() => { api.get(`/people/${person.id}/growth`).then(setG).catch(() => setG(null)); }, [person.id]);

  async function build() {
    setBusy(true);
    try { setG(await api.post(`/people/${person.id}/growth`)); setOpen(true); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }

  if (g === undefined) return null;
  const items = (g?.timeline || []).filter(t => filter === 'all' || t.type === filter);
  const groups = [];
  for (const t of [...items].reverse()) { // newest first
    const k = month(t.date);
    if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
    groups.at(-1).items.push(t);
  }

  return (
    <section className="card mt">
      <div className="analysis-head">
        <Icon name="insights" /><h2>Growth</h2>
        <button className="btn small" onClick={build} disabled={busy || !entryCount}>
          {busy ? <><span className="spinner" /> Reading…</> : g ? 'Refresh' : 'Build it'}
        </button>
      </div>
      {!g && !busy && <p className="muted small">{entryCount
        ? `${first}’s goals, wins, feedback you’ve given, concerns and milestones over time, each linked to the note it came from. Plus a draft to start their review from.`
        : `Link notes to ${first} to build their growth record.`}</p>}
      {g && <>
        <p className="small muted" style={{ marginTop: 0 }}>From {g.entry_count} notes{g.covers?.from ? `, ${short(g.covers.from)} to ${short(g.covers.to)}` : ''} · built {formatDate(g.created_at).toLowerCase()}</p>
        {g.summary && <p style={{ marginTop: 0 }}>{g.summary}</p>}

        {g.goals?.length > 0 && <>
          <div className="day-label" style={{ margin: '14px 0 4px' }}>Goals</div>
          {g.goals.map((x, i) => (
            <div key={i} className="todo-row" style={{ alignItems: 'flex-start' }}>
              <span className={`chip${x.status === 'achieved' ? ' accent' : ''}`} style={{ fontSize: 12, padding: '1px 8px', flex: 'none' }}>{STATUS[x.status]}</span>
              <div className="grow">
                {x.goal}
                <div className="small muted">{[x.progress, x.first_seen && `since ${short(x.first_seen)}`].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ))}
        </>}

        {g.timeline?.length > 0 && <>
          <div className="day-label" style={{ margin: '14px 0 4px' }}>Over time</div>
          <div className="chips" style={{ marginBottom: 6 }}>
            {FILTERS.filter(([k]) => k === 'all' || g.timeline.some(t => t.type === k)).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {groups.slice(0, open ? groups.length : 3).map(gr => (
            <div key={gr.k}>
              <div className="small muted" style={{ margin: '10px 0 2px', fontWeight: 600 }}>{gr.k}</div>
              {gr.items.map((t, i) => (
                <div key={i} className="growth-item">
                  <span className="growth-dot" style={{ background: TYPE[t.type].color }} aria-hidden="true" />
                  <div className="grow">
                    <span className="small" style={{ color: TYPE[t.type].color, fontWeight: 600 }}>{TYPE[t.type].label}</span>
                    <span className="small muted"> · {short(t.date)}</span>
                    <div>{t.text}</div>
                    {t.entry_id && <Link className="small" to={`/entry/${t.entry_id}`}>{t.entry_title}</Link>}
                    {(t.type === 'win' || t.type === 'milestone') && <>{t.entry_id ? ' · ' : ''}<Link className="small" to={`/career?recognize=${person.id}&win=${encodeURIComponent(t.text.slice(0, 600))}#drafts`}>Give kudos</Link></>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {groups.length > 3 && <button type="button" className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show all ${items.length}`}</button>}
        </>}

        {(g.strengths?.length > 0 || g.growth_areas?.length > 0) && (
          <div className="growth-cols">
            {g.strengths?.length > 0 && <div><div className="day-label" style={{ margin: '14px 0 4px' }}>Strengths</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{g.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
            {g.growth_areas?.length > 0 && <div><div className="day-label" style={{ margin: '14px 0 4px' }}>Growing into</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{g.growth_areas.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          </div>
        )}

        {g.review_notes && <details className="mt">
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Review draft</summary>
          <div className="md small" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(g.review_notes) }} />
          <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(g.review_notes).then(() => notify('Copied'))}>Copy</button>
          <p className="small muted" style={{ marginBottom: 0 }}>A starting point from your notes. Check it against your own judgment before using it.</p>
        </details>}
      </>}
    </section>
  );
}
