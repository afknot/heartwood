import { useState } from 'react';
import Sheet from './Sheet.jsx';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { useApp } from '../lib/context.js';
import { RELATIONSHIPS } from '../lib/format.js';
import { PersonForm } from '../pages/People.jsx';
import Avatar from './Avatar.jsx';

export { initials } from './Avatar.jsx';

/** Choose people involved in an entry. Can add someone new inline. */
export function PeoplePicker({ open, onClose, selected, onChange }) {
  const { people, refreshPeople } = useApp();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(null); // name being added
  const sel = new Set(selected);
  const shown = people.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  const exact = people.some(p => p.name.toLowerCase() === q.trim().toLowerCase());

  async function addNew(f) {
    const p = await api.post('/people', f);
    await refreshPeople();
    onChange([...selected, p.id]);
    setQ(''); setCreating(null);
  }

  if (creating !== null) {
    return (
      <Sheet open={open} onClose={() => { setCreating(null); onClose(); }} title="Add a person">
        <PersonForm key={creating} initial={{ name: creating }} compact submitLabel="Add" onSubmit={addNew} onCancel={() => setCreating(null)} />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Who was involved?">
      <div className="search mb"><Icon name="search" size={18} />
        <input placeholder="Search or add a name" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="pick-list">
        {shown.map(p => (
          <button key={p.id} className="pick" onClick={() => onChange(sel.has(p.id) ? selected.filter(x => x !== p.id) : [...selected, p.id])}>
            <Avatar person={p} />
            <span className="grow"><b>{p.name}</b><br /><span className="small muted">{p.role || RELATIONSHIPS[p.relationship] || ''}</span></span>
            <span className={`tick${sel.has(p.id) ? ' on' : ''}`}>{sel.has(p.id) && <Icon name="check" size={14} />}</span>
          </button>
        ))}
        {q.trim() && !exact && (
          <button className="pick" onClick={() => setCreating(q.trim())}>
            <span className="avatar"><Icon name="plus" size={18} /></span>
            <span className="grow">Add <b>{q.trim()}</b></span>
          </button>
        )}
        {!people.length && !q && <p className="muted small">No people yet. Type a name to add your first.</p>}
      </div>
      <button className="btn primary block" onClick={onClose}>Done</button>
    </Sheet>
  );
}

export function TagEditor({ open, onClose, tags, onChange, suggestions = [] }) {
  const [v, setV] = useState('');
  const add = t => {
    const tag = t.trim().toLowerCase().replace(/^#/, '');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setV('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Tags">
      <form onSubmit={e => { e.preventDefault(); add(v); }} className="row mb">
        <input className="input" placeholder="Add a tag" value={v} onChange={e => setV(e.target.value)} autoCapitalize="none" />
        <button className="btn" disabled={!v.trim()}>Add</button>
      </form>
      <div className="chips mb">
        {tags.map(t => <button key={t} className="chip on" onClick={() => onChange(tags.filter(x => x !== t))}>#{t} <Icon name="x" size={14} className="x" /></button>)}
      </div>
      {suggestions.filter(s => !tags.includes(s)).length > 0 && <>
        <p className="small muted">Used before</p>
        <div className="chips mb">
          {suggestions.filter(s => !tags.includes(s)).slice(0, 24).map(s => <button key={s} className="chip" onClick={() => add(s)}>#{s}</button>)}
        </div>
      </>}
      <button className="btn primary block" onClick={onClose}>Done</button>
    </Sheet>
  );
}
