import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import { VoiceTextarea } from './VoiceInput.jsx';
import { useApp } from '../lib/context.js';

/**
 * Add a few to-dos at once: type them (one per line) or tap the mic and say them. Heartwood splits
 * them up, links the people you name and picks up any dates, then shows what it added.
 */
export function QuickAdd({ onAdded, onDone, showOnToday = false, autoFocus = false }) {
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try { const r = await api.post('/followups/quick', { text }); setAdded(r); setText(''); onAdded?.(r); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  async function undo() {
    await api.post('/followups/quick/undo', { ids: added.ids }).catch(() => {});
    setText(added.added.map(f => f.text).join('\n')); setAdded(null); onAdded?.(null);
  }

  if (added) {
    return (
      <div className="quick-add">
        <p style={{ margin: '0 0 8px' }}><Icon name="check" size={16} /> Added {added.added.length} to your follow-ups</p>
        <ul className="quick-list">
          {added.added.map(f => (
            <li key={f.id}>
              <span>{f.text}</span>
              {(f.person_name || f.due) && <small className="muted">{[!f.mine && f.person_name ? `Waiting on ${f.person_name.split(' ')[0]}` : f.person_name, f.due && `due ${f.due}`].filter(Boolean).join(' · ')}</small>}
            </li>
          ))}
        </ul>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn small primary" onClick={() => setAdded(null)}><Icon name="plus" size={15} /> Add more</button>
          <button className="btn small ghost" onClick={undo}>Undo</button>
          <span className="grow" />
          {showOnToday ? <Link className="btn small" to="/">See them on Today</Link> : onDone && <button className="btn small" onClick={onDone}>Done</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="quick-add">
      <VoiceTextarea value={text} onChange={setText} rows={4} autoFocus={autoFocus} label="To-dos"
        placeholder={'One per line, or tap the mic and say them:\n“Send Maya the deck by Friday, book the offsite, Sam owes me the budget”'} />
      <button className="btn primary block" style={{ marginTop: 10 }} onClick={add} disabled={busy || !text.trim()}>
        {busy ? <><span className="spinner" /> Adding…</> : <><Icon name="plus" size={17} /> Add to follow-ups</>}
      </button>
      <p className="small muted" style={{ margin: '8px 0 0' }}>Name someone to link it to them. Say “Sam owes me…” for things you’re waiting on.</p>
    </div>
  );
}

export function QuickAddSheet({ open, onClose, onAdded }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add to-dos">
      {open && <QuickAdd onAdded={onAdded} onDone={onClose} autoFocus />}
    </Sheet>
  );
}
