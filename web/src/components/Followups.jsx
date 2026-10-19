import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { formatDate, renderMarkdown } from '../lib/format.js';
import Sheet from './Sheet.jsx';
import { useApp } from '../lib/context.js';
import { useAttachments, AttachmentChips } from './Attachments.jsx';
import { pastedFiles, dropProps } from '../lib/pasteFiles.js';
import { AgendaBuilder } from './Agenda.jsx';

const PRIO = { high: 'Important' };

/**
 * One open loop: tick it off, see where it came from, or dismiss it.
 * `selecting`: the tick becomes a selection box. `archived`: shows Restore instead.
 * Open items arrive ranked, with `priority`, `reasons` (due, asked again, your manager) and `also`:
 * the same ask from other notes, folded into this one and settled along with it.
 */
export function FollowupItem({ f, onChange, showPerson = true, selecting = false, selected = false, onSelect, archived = false }) {
  const [done, setDone] = useState(!!f.done_at);
  const [responding, setResponding] = useState(false);
  const [lettingGo, setLettingGo] = useState(false);
  const ids = [f.id, ...(f.also || [])];
  async function letGo(reason) {
    setLettingGo(false);
    if (reason === 'not_real') await api.post('/followups/bulk', { ids, action: 'dismiss' });
    else await api.post('/followups/let-go', { ids, reason });
    onChange?.();
  }
  async function toggle() {
    if (selecting) return onSelect?.(f.id);
    const next = !done;
    setDone(next);
    try {
      if (next && ids.length > 1) await api.post('/followups/bulk', { ids, action: 'done' });
      else await Promise.all(ids.map(id => api.patch(`/followups/${id}`, { done: next })));
      setTimeout(() => onChange?.(), 400);
    } catch { setDone(!next); }
  }
  async function dismiss() {
    await api.post('/followups/bulk', { ids, action: 'dismiss' });
    onChange?.();
  }
  async function restore() {
    await api.post('/followups/restore', { ids: [f.id] });
    onChange?.();
  }
  const meta = [
    !f.mine && f.owner ? f.owner : null,
    showPerson && f.person_name && (f.mine || f.owner !== f.person_name) ? f.person_name : null,
    f.due && !f.reasons?.some(r => r.kind === 'due') ? `due ${f.due}` : null
  ].filter(Boolean);
  const on = selecting ? selected : done;
  const showPrio = !done && !archived && !!(PRIO[f.priority] || f.reasons?.length);
  return (
    <div className={`todo-row${selecting ? ' picking-row' : ''}${selecting && selected ? ' picked' : ''}`}
      onClick={selecting ? e => { if (!e.target.closest('a, button')) onSelect?.(f.id); } : undefined}>
      {!archived && (
        <button className={`tick${on ? ' on' : ''}${selecting ? ' picking' : ''}`} onClick={toggle}
          aria-label={selecting ? (selected ? 'Deselect' : 'Select') : done ? 'Mark as not done' : 'Mark as done'} aria-pressed={selecting ? selected : undefined}>
          {on && <Icon name="check" size={14} />}
        </button>
      )}
      <div className="grow" style={{ color: done || archived ? 'var(--ink-3)' : undefined }}>
        <span style={{ textDecoration: done && !selecting ? 'line-through' : 'none' }}>{f.text}</span>
        {showPrio && (
          <div className="prio-line">
            {PRIO[f.priority] && <span className={`prio ${f.priority}`}><span className="sr-only">Priority: </span>{PRIO[f.priority]}</span>}
            {f.reasons?.map(r => <span key={r.kind} className={`prio${r.urgent ? ' urgent' : ''}`}>{r.label}</span>)}
          </div>
        )}
        <div className="small muted">
          {meta.join(' · ')}
          {f.entry_id && <>{meta.length ? ' · ' : ''}<Link to={`/entry/${f.entry_id}?hl=${f.id}`} title="Open the note with this highlighted">{f.entry_title || 'note'}{f.entry_date ? `, ${formatDate(f.entry_date)}` : ''}</Link></>}
        </div>
      </div>
      {archived
        ? <button className="btn small ghost" onClick={restore}>Restore</button>
        : !selecting && !done && <>
          <button className="icon-btn" onClick={() => setResponding(true)} aria-label="Respond" title="Say what’s happening"><Icon name="ask" size={15} /></button>
          <button className="icon-btn" onClick={() => setLettingGo(!lettingGo)} aria-label="Let it go" aria-expanded={lettingGo} title="Let it go"><Icon name="x" size={14} /></button>
        </>}
      {lettingGo && (
        <div className="letgo" role="group" aria-label="Let it go">
          <span className="small muted letgo-label">Let it go. It counts as handled.</span>
          <button className="chip" onClick={() => letGo('decided')}>Decided not to</button>
          <button className="chip" onClick={() => letGo('not_needed')}>No longer needed</button>
          <button className="chip" onClick={() => letGo('not_real')}>Not a real follow-up</button>
          <button className="chip" onClick={() => setLettingGo(false)} aria-label="Cancel"><Icon name="x" size={12} /></button>
        </div>
      )}
      {responding && <RespondSheet open onClose={() => setResponding(false)} followup={f} onApplied={() => onChange?.()} />}
    </div>
  );
}

const ACTION_LABEL = { done: 'Done', dismiss: 'No longer relevant', update: 'Reword' };

/**
 * Respond in your own words ("We moved the offsite to spring; Sam already sent the deck") and let
 * Heartwood find every open follow-up that settles. You review and confirm; nothing changes before.
 */
export function RespondSheet({ open, onClose, followup = null, personId = null, onApplied }) {
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { changes, candidate_count }
  const [picked, setPicked] = useState({}); // id -> bool
  const [edits, setEdits] = useState({}); // id -> new wording
  const [saveNote, setSaveNote] = useState(true);
  const [err, setErr] = useState('');
  const att = useAttachments();
  const [over, setOver] = useState(false);
  const fileInput = useRef();

  async function find(e) {
    e?.preventDefault();
    if ((!text.trim() && !att.ready.length) || att.uploading) return;
    setBusy(true); setErr('');
    try {
      const r = await api.post('/followups/respond', { text, attachments: att.ready.map(f => f.id), followup_id: followup?.id || null, person_id: personId || followup?.person_id || null });
      setResult(r);
      setPicked(Object.fromEntries(r.changes.map(c => [c.id, true])));
      setEdits(Object.fromEntries(r.changes.filter(c => c.action === 'update').map(c => [c.id, c.text])));
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }
  async function apply(extra = []) {
    setBusy(true);
    try {
      const changes = [...(result?.changes || []).filter(c => picked[c.id]).map(c => ({ id: c.id, action: c.action, text: edits[c.id] ?? c.text })), ...extra];
      const pid = personId || followup?.person_id || null;
      const r = await api.post('/followups/respond/apply', {
        changes,
        note: saveNote ? { text: followup ? `**Re: ${followup.text}**\n\n${text.trim()}` : text.trim(), title: 'Follow-up update', person_id: pid, followup_id: followup?.id || null, attachments: att.ready.map(f => f.id) } : null
      });
      notify(r.changed ? `Updated ${r.changed} follow-up${r.changed === 1 ? '' : 's'}` : 'Saved');
      onApplied?.(r); onClose();
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }
  const count = (result?.changes || []).filter(c => picked[c.id]).length;

  return (
    <Sheet open={open} onClose={onClose} title={followup ? 'What’s happening?' : 'Give an update'}>
      {followup && <p className="small muted" style={{ marginTop: -6 }}>“{followup.text}”</p>}
      {!result ? (
        <form onSubmit={find}>
          <label className="field"><span>In your own words</span>
            <textarea className={`textarea${over ? ' drop-over' : ''}`} autoFocus value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 120 }}
              onPaste={e => { const f = pastedFiles(e); if (f.length) { e.preventDefault(); att.attach(f); } }} {...dropProps(att.attach, setOver)}
              placeholder={followup ? 'Done, moved, waiting on someone, or no longer needed? Add anything that also settles other follow-ups.' : 'What’s changed? e.g. a project wrapped, a decision got made, someone moved teams. Heartwood finds every follow-up it settles.'} />
          </label>
          <div className="composer-chips" style={{ marginTop: -6 }}>
            <AttachmentChips files={att.files} onRemove={att.remove} />
            <button type="button" className="chip small-chip" onClick={() => fileInput.current?.click()}><Icon name="clip" size={13} /> Add a file or photo</button>
            <input ref={fileInput} type="file" multiple hidden accept=".docx,.pdf,.pptx,.xlsx,.xls,.csv,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/*"
              onChange={e => { att.attach(e.target.files); e.target.value = ''; }} />
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>Paste or drop a screenshot, email or document and Heartwood reads it too.</p>
          {err && <div className="banner error" role="alert">{err}</div>}
          <button className="btn primary block" disabled={busy || att.uploading || (!text.trim() && !att.ready.length)}>{busy ? <><span className="spinner" /> Reading your follow-ups…</> : 'Find what this settles'}</button>
        </form>
      ) : <>
        {result.changes.length === 0 ? (
          <p className="muted">Nothing in your open follow-ups looks settled by this{followup ? ', including this one' : ''}. You can still save it as a note{followup ? ' or mark this one done' : ''}.</p>
        ) : (
          <p className="small muted" style={{ marginTop: 0 }}>Checked {result.candidate_count} open follow-ups. Untick anything that isn’t right.</p>
        )}
        {result.changes.map(c => (
          <label key={c.id} className="todo-row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={!!picked[c.id]} onChange={e => setPicked({ ...picked, [c.id]: e.target.checked })} style={{ marginTop: 4, width: 18, height: 18, flex: 'none' }} />
            <span className="grow">
              <span className={`chip${c.action === 'done' ? ' accent' : ''}`} style={{ fontSize: 12, padding: '1px 8px', marginRight: 6 }}>{ACTION_LABEL[c.action]}</span>
              <span style={{ textDecoration: c.action === 'update' ? 'none' : 'line-through', color: 'var(--ink-2)' }}>{c.original}</span>
              {c.action === 'update' && <input className="input" value={edits[c.id] ?? ''} onChange={e => setEdits({ ...edits, [c.id]: e.target.value })} style={{ marginTop: 6, minHeight: 36, padding: '4px 10px' }} aria-label="New wording" />}
              <span className="small muted" style={{ display: 'block' }}>{[c.person_name, c.why].filter(Boolean).join(' · ')}</span>
            </span>
          </label>
        ))}
        <label className="toggle" style={{ borderTop: 0 }}>
          <span className="grow">Save my update as a note<small>Keeps the context in your journal.</small></span>
          <span className="switch"><input type="checkbox" checked={saveNote} onChange={e => setSaveNote(e.target.checked)} /><i /></span>
        </label>
        {err && <div className="banner error" role="alert">{err}</div>}
        <button className="btn primary block" disabled={busy || (!count && !saveNote)} onClick={() => apply()}>
          {busy ? 'Saving…' : count ? `Update ${count} follow-up${count === 1 ? '' : 's'}` : 'Save note'}
        </button>
        {followup && !result.changes.some(c => c.id === followup.id) && (
          <button className="btn block" style={{ marginTop: 8 }} disabled={busy} onClick={() => apply([{ id: followup.id, action: 'done' }])}>Also mark this one done</button>
        )}
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setResult(null)}>Back</button>
      </>}
    </Sheet>
  );
}

const TIDY_AGES = [[30, '1 month'], [60, '2 months'], [90, '3 months'], [180, '6 months'], [365, '1 year']];

/** Archive follow-ups from old notes in one go, keeping ones that came up again recently. */
export function TidySheet({ open, onClose, onDone }) {
  const [days, setDays] = useState(90);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showKept, setShowKept] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPlan(null);
    api.get(`/followups/tidy?days=${days}`).then(setPlan).catch(() => {});
  }, [open, days]);
  async function apply() {
    setBusy(true);
    try { const r = await api.post('/followups/tidy', { days }); onDone?.(r); onClose(); }
    finally { setBusy(false); }
  }
  const before = plan ? new Date(plan.cutoff).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  return (
    <Sheet open={open} onClose={onClose} title="Tidy up follow-ups">
      <p className="muted" style={{ marginTop: -6 }}>Archive open follow-ups from older notes so the current ones stand out. Archived items aren’t deleted; restore them any time.</p>
      <div className="field"><span>From notes older than</span>
        <div className="chips">
          {TIDY_AGES.map(([d, label]) => <button key={d} type="button" aria-pressed={days === d} className={`chip${days === d ? ' on' : ''}`} onClick={() => setDays(d)}>{label}</button>)}
        </div>
      </div>
      {!plan ? <p className="muted"><span className="spinner" /> Looking…</p> : <>
        <div className="card" style={{ padding: '12px 16px', margin: '4px 0 12px' }}>
          <p style={{ margin: 0 }}><b>{plan.archive_count}</b> to archive, from notes before {before}.</p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Keeping <b>{plan.keep_count}</b> that came up again in a note in the last 6 weeks.
            {plan.keep_count > 0 && <> <button type="button" className="linklike" onClick={() => setShowKept(!showKept)}>{showKept ? 'Hide' : 'See them'}</button></>}
          </p>
          {showKept && <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{plan.keep.map(f => <li key={f.id}>{f.text}{f.person_name ? <span className="muted"> · {f.person_name}</span> : ''}</li>)}</ul>}
        </div>
        <button className="btn primary block" disabled={busy || !plan.archive_count} onClick={apply}>
          {busy ? 'Archiving…' : plan.archive_count ? `Archive ${plan.archive_count}` : 'Nothing that old'}
        </button>
      </>}
      <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
    </Sheet>
  );
}

/** Quick add: "Send Sam the offsite notes". */
export function AddFollowup({ personId, onAdded, mine = true }) {
  const [text, setText] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await api.post('/followups', { text, person_id: personId || null, owner: mine ? 'me' : '' });
    setText(''); onAdded?.();
  }
  return (
    <form onSubmit={submit} className="row" style={{ marginTop: 8 }}>
      <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder="Add a follow-up" style={{ minHeight: 38, padding: '6px 12px' }} />
      <button className="btn small" disabled={!text.trim()}>Add</button>
    </form>
  );
}

/** Meeting prep in a sheet: show the latest one, or write a fresh one. */
export function PrepSheet({ open, onClose, person, event, existingId, onCreated, initialTab = 'prep' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const [prep, setPrep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setPrep(null); setErr('');
    if (existingId) api.get(`/reports/${existingId}`).then(setPrep).catch(() => {});
  }, [open, existingId, person?.id, event?.key]);
  async function generate() {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/prep', { person_id: person.id, event_key: event?.key || null });
      setPrep(r); onCreated?.(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={event ? event.title : `Prep for ${person?.name?.split(' ')[0] || ''}`}>
      {event && <p className="small muted" style={{ marginTop: -8 }}>{new Date(event.start).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · with {person?.name}</p>}
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === 'prep'} className={tab === 'prep' ? 'on' : ''} onClick={() => setTab('prep')}>Prep</button>
        <button role="tab" aria-selected={tab === 'agenda'} className={tab === 'agenda' ? 'on' : ''} onClick={() => setTab('agenda')}>Agenda</button>
      </div>
      {tab === 'agenda' ? (open && person && <AgendaBuilder person={person} event={event} onDone={onClose} />) : <>
      {prep && <>
        <p className="small muted">Written {formatDate(prep.created_at, { time: true })}</p>
        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(prep.content_md) }} />
      </>}
      {!prep && !busy && <p className="muted">Heartwood reads your recent notes and open follow-ups with {person?.name?.split(' ')[0]} and gets you ready: what’s changed, what’s open, what to raise and what to ask.</p>}
      {err && <div className="banner error" role="alert">{err}</div>}
      <button className="btn primary block mt" onClick={generate} disabled={busy}>
        {busy ? <><span className="spinner" /> Getting you ready…</> : prep ? 'Refresh prep' : 'Prep me'}
      </button>
      {person && <Link className="btn ghost block" style={{ marginTop: 8 }} to={`/people/${person.id}`} onClick={onClose}>Open {person.name.split(' ')[0]}’s page</Link>}
      </>}
    </Sheet>
  );
}
