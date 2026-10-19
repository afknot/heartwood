import Icon from './Icon.jsx';
import { formatDate } from '../lib/format.js';

export default function AnalysisPanel({ entry, onRun, onAddTodos, busy }) {
  const a = entry.analysis;
  const running = busy || entry.status === 'analyzing';
  const canRun = entry.status !== 'transcribing' && (entry.body_md?.trim() || entry.transcript?.trim());

  return (
    <section className="analysis card">
      <div className="analysis-head">
        <Icon name="sparkle" />
        <h2>Reflection</h2>
        <button className="btn small" onClick={onRun} disabled={!canRun || running}>
          {running ? <><span className="spinner" /> Thinking…</> : a ? 'Refresh' : 'Reflect'}
        </button>
      </div>

      {!a && !running && (
        <p className="muted small">
          {canRun ? 'Get a summary, follow-ups you may have missed, and coaching ideas for this entry.' : 'Write or record something, then reflect on it.'}
        </p>
      )}
      {running && !a && <p className="muted small">Reading your entry and earlier notes about the same people…</p>}

      {a && <>
        {entry.analysis_at && <p className="small muted" style={{ marginTop: 0 }}>Updated {formatDate(entry.analysis_at, { time: true })}</p>}
        {a.summary && <div className="a-block"><p className="a-summary">{a.summary}</p>
          {a.themes?.length > 0 && <div className="chips mt">{a.themes.map(t => <span key={t} className="chip accent">{t}</span>)}</div>}
        </div>}

        {a.action_items?.length > 0 && <div className="a-block" data-source="reflection">
          <div className="row between"><h4>Follow-ups</h4>
            <button className="btn ghost small" onClick={() => onAddTodos(a.action_items)}>Add to note</button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {a.action_items.map((x, i) => (
              <div key={i} className="todo"><Icon name="check" size={18} />
                <div>{x.text}{(x.owner || x.due) && <div className="meta">{[x.owner, x.due].filter(Boolean).join(' · ')}</div>}</div>
              </div>
            ))}
          </div>
        </div>}

        <List title="You may have missed" items={a.missed} />

        {a.coaching?.length > 0 && <div className="a-block"><h4>Lead, mentor, coach</h4>
          {a.coaching.map((c, i) => (
            <div key={i} className="coach">
              <div className="who">{c.person || 'Team'}</div>
              {c.insight && <p className="muted">{c.insight}</p>}
              {c.suggestion && <p className="say">{c.suggestion}</p>}
            </div>
          ))}
        </div>}

        {a.communication?.length > 0 && <div className="a-block"><h4>How you showed up</h4>
          {a.communication.map((c, i) => (
            <div key={i} className="coach">
              {c.observation && <p style={{ marginTop: 0 }}>{c.observation}</p>}
              {c.suggestion && <p className="say">{c.suggestion}</p>}
            </div>
          ))}
        </div>}

        <List title="Keep an eye on" items={a.watch} />
        <List title="Questions to sit with" items={a.reflect} />
      </>}
    </section>
  );
}

function List({ title, items }) {
  if (!items?.length) return null;
  return <div className="a-block"><h4>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}
