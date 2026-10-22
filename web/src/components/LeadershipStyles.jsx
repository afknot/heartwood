import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const MAX = 3;

/** Pick up to three leadership styles you're growing toward. Stored as "servant,space". */
export function StylePicker({ value, onChange }) {
  const [styles, setStyles] = useState(null);
  useEffect(() => { api.get('/leadership/styles').then(setStyles).catch(() => setStyles([])); }, []);
  const picked = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const toggle = key => {
    const next = picked.includes(key) ? picked.filter(k => k !== key) : picked.length < MAX ? [...picked, key] : picked;
    onChange(next.join(','));
  };
  if (!styles) return null;
  return (
    <fieldset className="field style-picker">
      <legend>The kind of leader you want to be</legend>
      <small style={{ display: 'block', marginBottom: 8 }}>Pick up to {MAX}. Coaching, prep, 1:1 agendas, the quote of the day and Something to try lean toward them.</small>
      <div className="style-grid">
        {styles.map(s => {
          const on = picked.includes(s.key);
          const full = !on && picked.length >= MAX;
          return (
            <button type="button" key={s.key} className={`style-option${on ? ' on' : ''}`} aria-pressed={on} disabled={full} onClick={() => toggle(s.key)}>
              <span className="style-check" aria-hidden="true">{on && <Icon name="check" size={13} />}</span>
              <span className="grow"><b>{s.label}</b><small>{s.short}</small></span>
            </button>
          );
        })}
      </div>
      {picked.length >= MAX && <small style={{ display: 'block', marginTop: 6 }}>That’s three. Tap one to swap it out.</small>}
    </fieldset>
  );
}

const SUGGESTIONS = ['Ted Lasso', 'Abraham Lincoln', 'Apollo 13', 'Star Trek', 'Coach John Wooden', 'Women of the civil rights movement'];

/**
 * Your inspiration: shows, films, books, people or eras you learn leadership from. Heartwood builds
 * quotes and things to try from each one in the background.
 */
/** What one source built: quotes and things to try, each removable. */
function InspirationItems({ id, onChanged }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get(`/inspirations/${id}/items`).then(setItems).catch(() => setItems([])); }, [id]);
  if (!items) return <p className="small muted">Loading…</p>;
  if (!items.length) return <p className="small muted">Nothing extra built for this one.</p>;
  const drop = async itemId => { onChanged(await api.del(`/inspirations/items/${itemId}`)); setItems(items.filter(i => i.id !== itemId)); };
  return (
    <ul className="insp-items">
      {items.map(i => (
        <li key={i.id}>
          <div className="grow" style={{ minWidth: 0 }}>
            {i.kind === 'quote'
              ? <><q>{i.text}</q> <small className="muted">— {i.who}, {i.work}</small></>
              : <><b>{i.title}</b> <small className="muted">{i.how}</small></>}
          </div>
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => drop(i.id)}><Icon name="x" size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

export function InspirationPicker() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => api.get('/inspirations').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  // While something is being built, check back every few seconds.
  const building = list?.some(i => i.status === 'building');
  useEffect(() => { if (!building) return undefined; const t = setInterval(load, 4000); return () => clearInterval(t); }, [building]);

  async function add(n = name) {
    if (!n.trim()) return;
    setBusy(true); setErr('');
    try { setList(await api.post('/inspirations', { name: n.trim() })); setName(''); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  const status = i => i.status === 'building' ? <><span className="spinner" /> Building quotes and things to try…</>
    : i.status === 'error' ? <span style={{ color: 'var(--rec-text)' }}>Couldn’t build this one: {i.error}</span>
      : i.quotes + i.practices === 0 ? (i.note || (i.pack ? 'Uses Heartwood’s built-in set' : 'Nothing to build from this one'))
        : `${i.quotes} quote${i.quotes === 1 ? '' : 's'} · ${i.practices} thing${i.practices === 1 ? '' : 's'} to try${i.pack ? ', plus Heartwood’s built-in set' : ''}`;
  if (!list) return null;
  const taken = new Set(list.map(i => i.name.toLowerCase()));
  return (
    <fieldset className="field inspiration">
      <legend>Where you find inspiration</legend>
      <small style={{ display: 'block', marginBottom: 8 }}>Shows, films, books, people or moments in history you learn leadership from. Heartwood builds quotes and Something to try from each, and Today leans toward them. AI-picked quotes are marked so you can check them before you share one.</small>
      {list.length > 0 && <ul className="insp-list">
        {list.map(i => (
          <li key={i.id} className="insp-item">
            <div className="insp-row">
            <button type="button" className="grow insp-name" style={{ minWidth: 0 }} aria-expanded={open === i.id} disabled={i.status === 'building' || i.quotes + i.practices === 0} onClick={() => setOpen(open === i.id ? null : i.id)}>
              <b>{i.name}</b>
              <small className="muted" role={i.status === 'building' ? 'status' : undefined}>{status(i)}</small>
            </button>
            {i.status !== 'building' && <button type="button" className="icon-btn" title="Build a fresh set" aria-label={`Build a fresh set from ${i.name}`} onClick={() => api.post(`/inspirations/${i.id}/rebuild`).then(setList).catch(e => setErr(e.message))}><Icon name="retry" size={16} /></button>}
            <button type="button" className="icon-btn" aria-label={`Remove ${i.name}`} onClick={() => api.del(`/inspirations/${i.id}`).then(setList).catch(e => setErr(e.message))}><Icon name="x" size={16} /></button>
            </div>
            {open === i.id && <InspirationItems id={i.id} onChanged={setList} />}
          </li>
        ))}
      </ul>}
      <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); add(); }}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Add a show, film, book or person" aria-label="Add inspiration" maxLength={80} />
        <button className="btn small primary" disabled={busy || !name.trim()}>{busy ? <span className="spinner" /> : 'Add'}</button>
      </form>
      {err && <p className="small" role="alert" style={{ color: 'var(--rec-text)', margin: '6px 0 0' }}>{err}</p>}
      <div className="chips" style={{ marginTop: 8 }}>
        {SUGGESTIONS.filter(s => !taken.has(s.toLowerCase())).slice(0, 4).map(s => <button type="button" key={s} className="chip" onClick={() => add(s)}><Icon name="plus" size={13} /> {s}</button>)}
      </div>
    </fieldset>
  );
}
