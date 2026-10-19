import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import Avatar from '../components/Avatar.jsx';
import { api } from '../api.js';
import { useApp } from '../lib/context.js';
import { RELATIONSHIPS, formatDate } from '../lib/format.js';
import { zoneOptions, tzLabel, guessTz, whereLine, MY_TZ } from '../lib/time.js';

function TzSelect({ value, onChange }) {
  const { common, rest } = zoneOptions();
  const extra = value && !common.includes(value) && !rest.includes(value) ? [value] : [];
  return (
    <select className="select" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">Not set</option>
      <optgroup label="Common">{[...extra, ...common].map(z => <option key={z} value={z}>{tzLabel(z)}{z === MY_TZ ? ' · yours' : ''}</option>)}</optgroup>
      {rest.length > 0 && <optgroup label="All time zones">{rest.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>}
    </select>
  );
}

export const PRONOUNS = ['they/them', 'she/her', 'he/him', 'she/they', 'he/they', 'any pronouns'];

/** Pronouns dropdown: they/them by default, the common sets, then your own wording. */
function PronounsField({ value, onChange }) {
  const v = value || 'they/them';
  const [custom, setCustom] = useState(!PRONOUNS.includes(v));
  return (
    <div className="field"><span id="pronouns-label">Pronouns</span>
      <select aria-labelledby="pronouns-label" className="select" value={custom ? 'custom' : v}
        onChange={e => { if (e.target.value === 'custom') { setCustom(true); onChange(PRONOUNS.includes(v) ? '' : v); } else { setCustom(false); onChange(e.target.value); } }}>
        {PRONOUNS.map(x => <option key={x} value={x}>{x}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {custom && <input className="input" value={value || ''} maxLength={40} autoFocus
        onChange={e => onChange(e.target.value)} placeholder="e.g. ze/hir, xe/xem, name only" aria-label="Custom pronouns" />}
      <small>Heartwood uses these whenever it writes about them.</small>
    </div>
  );
}

/** Add or edit a person. Only the name is required. `compact` hides notes (quick add from a note). */
export function PersonForm({ initial = {}, onSubmit, onCancel, submitLabel = 'Save', compact = false }) {
  const [f, setF] = useState({ name: '', role: '', relationship: '', notes: '', email: '', city: '', tz: '', pronouns: 'they/them', ...initial });
  const [tzTouched, setTzTouched] = useState(!!initial.tz);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={async e => { e.preventDefault(); if (!f.name.trim() || busy) return; setBusy(true); try { await onSubmit({ ...f, name: f.name.trim(), pronouns: (f.pronouns || '').trim() || 'they/them' }); } finally { setBusy(false); } }}>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set('name')} required autoFocus={!initial.id && !initial.name} /></label>
      <PronounsField value={f.pronouns} onChange={pronouns => setF(x => ({ ...x, pronouns }))} />
      {!compact && <label className="field"><span>Email <small>(optional)</small></span>
        <input className="input" type="email" autoCapitalize="none" value={f.email || ''} onChange={set('email')} placeholder="Matches them to calendar invites" />
      </label>}
      <label className="field"><span>Title <small>(optional)</small></span><input className="input" value={f.role} onChange={set('role')} placeholder="Their title" autoFocus={!initial.id && !!initial.name} /></label>
      <div className="field"><span>Your relationship <small>(optional)</small></span>
        <div className="chips">
          {Object.entries(RELATIONSHIPS).map(([k, v]) => (
            <button type="button" key={k} aria-pressed={f.relationship === k} className={`chip${f.relationship === k ? ' on' : ''}`} onClick={() => setF({ ...f, relationship: f.relationship === k ? '' : k })}>{v}</button>
          ))}
        </div>
      </div>
      {!compact && <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <label className="field" style={{ flex: 1 }}><span>City <small>(optional)</small></span>
          <input className="input" value={f.city || ''} placeholder="Where they work from"
            onChange={e => { const city = e.target.value; const g = !tzTouched && guessTz(city); setF({ ...f, city, ...(g ? { tz: g } : {}) }); }} />
        </label>
        <label className="field" style={{ flex: 1.2, minWidth: 0 }}><span>Time zone <small>(optional)</small></span>
          <TzSelect value={f.tz} onChange={tz => { setTzTouched(true); setF({ ...f, tz }); }} />
        </label>
      </div>}
      {!compact && <label className="field"><span>Notes <small>(optional)</small></span>
        <textarea className="textarea" value={f.notes} onChange={set('notes')} placeholder="Goals, strengths, what motivates them, how they like feedback, anything going on in their life you want to keep in mind…" />
        <small>Heartwood uses these notes as context when it coaches you.</small>
      </label>}
      <button className="btn primary block" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
      {onCancel && <button type="button" className="btn ghost block mt" style={{ marginTop: 8 }} onClick={onCancel}>Cancel</button>}
    </form>
  );
}

export default function People() {
  const { people, refreshPeople } = useApp();
  const [adding, setAdding] = useState(false);
  const nav = useNavigate();

  const PLURAL = { direct_report: 'Direct reports', peer: 'Peers', manager: 'Managers', stakeholder: 'Stakeholders', other: 'Others' };
  const groups = [...Object.keys(RELATIONSHIPS), '']
    .map(k => ({ k, label: k ? PLURAL[k] : 'Relationship not set', items: people.filter(p => (p.relationship || '') === k) }))
    .filter(g => g.items.length);

  async function add(f) {
    const p = await api.post('/people', f);
    await refreshPeople();
    setAdding(false);
    nav(`/people/${p.id}`);
  }

  return (
    <main className="page">
      <div className="topbar">
        <h1>People</h1>
        <button className="icon-btn" onClick={() => setAdding(true)} aria-label="Add person"><Icon name="plus" /></button>
      </div>

      {!people.length && (
        <div className="empty">
          <h2>Add the people you lead</h2>
          <p>Start with your direct reports. Linking entries to people lets Heartwood spot patterns in each relationship and prep you for 1:1s.</p>
          <button className="btn primary mt" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add a person</button>
        </div>
      )}

      {groups.map(g => (
        <section key={g.k}>
          <div className="day-label">{g.label}</div>
          {g.items.map(p => (
            <Link key={p.id} to={`/people/${p.id}`} className="person-item">
              <Avatar person={p} />
              <span className="grow">
                <div className="name">{p.name}</div>
                {(p.role || whereLine(p)) && <div className="sub">{[p.role, whereLine(p)].filter(Boolean).join(' · ')}</div>}
                <div className="sub">{[p.entry_count ? `${p.entry_count} entr${p.entry_count === 1 ? 'y' : 'ies'}` : 'No entries yet', p.last_entry_at && `last ${formatDate(p.last_entry_at).toLowerCase()}`].filter(Boolean).join(' · ')}</div>
              </span>
            </Link>
          ))}
        </section>
      ))}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a person">
        <PersonForm onSubmit={add} submitLabel="Add" />
      </Sheet>
    </main>
  );
}
