import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const uid = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0');
// Text boxes that grow with what's in them (phones can't fit an agenda item on one line).
const fit = el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };

/** Build a structured 1:1 agenda, edit it, share the parts meant for them, and start notes from it. */
export function AgendaBuilder({ person, event, onDone }) {
  const nav = useNavigate();
  const first = person?.name?.split(' ')[0] || '';
  const [templates, setTemplates] = useState(null);
  const [choice, setChoice] = useState('');
  const [agenda, setAgenda] = useState(undefined); // undefined = loading, null = none yet
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(null); // section key
  const [draft, setDraft] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!person) return;
    setAgenda(undefined); setErr(''); setNote('');
    api.get(`/agenda-templates?person=${encodeURIComponent(person.id)}`).then(r => { setTemplates(r.templates); setChoice(r.suggested); }).catch(e => setErr(e.message));
    const q = new URLSearchParams({ person: person.id, ...(event?.key ? { event_key: event.key } : {}) });
    api.get(`/agendas?${q}`).then(setAgenda).catch(() => setAgenda(null));
  }, [person?.id, event?.key]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const tpl = templates?.find(t => t.key === (agenda?.template || choice));

  async function build() {
    setBusy(true); setErr(''); setNote('');
    try {
      const a = await api.post('/agendas', { person_id: person.id, event_key: event?.key || null, template: choice });
      setAgenda(a); setNote(a.note || '');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function save(items) {
    setAgenda(a => ({ ...a, items }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.patch(`/agendas/${agenda.id}`, { items }).then(a => setAgenda(cur => ({ ...cur, share_text: a.share_text }))).catch(e => setErr(e.message));
    }, 500);
  }
  const change = (id, patch) => save(agenda.items.map(i => (i.id === id ? { ...i, ...patch } : i)));
  const remove = id => save(agenda.items.filter(i => i.id !== id));
  function add(section) {
    const text = draft.trim();
    if (text) save([...agenda.items, { id: uid(), section, text, from: 'you', private: false, done: false }]);
    setDraft(''); setAdding(null);
  }

  async function copy() {
    clearTimeout(timer.current);
    try {
      const a = await api.patch(`/agendas/${agenda.id}`, { items: agenda.items });
      await navigator.clipboard.writeText(a.share_text);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { setErr('Couldn’t copy. Select the text in your notes instead.'); }
  }
  async function startNotes() {
    clearTimeout(timer.current);
    try {
      await api.patch(`/agendas/${agenda.id}`, { items: agenda.items });
      const r = await api.post(`/agendas/${agenda.id}/notes`);
      onDone?.(); nav(`/entry/${r.entry_id}`);
    } catch (e) { setErr(e.message); }
  }
  async function startOver() {
    if (agenda?.id && !agenda.entry_id) await api.del(`/agendas/${agenda.id}`).catch(() => {});
    setAgenda(null); setNote('');
  }

  if (agenda === undefined || !templates) return <p className="muted">{err || 'Loading…'}</p>;

  // ---------- choose a kind of conversation ----------
  if (!agenda) return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>Pick the kind of conversation. Heartwood lays out a structure, brings in your open follow-ups with {first}, adds questions that fit your leadership style and suggests a few topics from your notes.</p>
      <div className="agenda-kinds" role="radiogroup" aria-label="Kind of conversation">
        {templates.map(t => (
          <button key={t.key} type="button" role="radio" aria-checked={choice === t.key} className={`agenda-kind${choice === t.key ? ' on' : ''}`} onClick={() => setChoice(t.key)}>
            <span className="grow"><b>{t.label}</b> <span className="small muted">· {t.minutes} min</span><small>{t.about}</small></span>
          </button>
        ))}
      </div>
      {err && <div className="banner error" role="alert">{err}</div>}
      <button className="btn primary block mt" onClick={build} disabled={busy || !choice}>
        {busy ? <><span className="spinner" /> Building from your notes…</> : 'Build agenda'}
      </button>
    </div>
  );

  // ---------- the agenda ----------
  const hiddenCount = agenda.items.filter(i => i.private).length;
  return (
    <div className="agenda">
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <span className="grow small muted">{tpl?.label} · about {tpl?.minutes} min</span>
        <button className="btn ghost small" onClick={startOver}>Change kind</button>
      </div>
      {tpl?.note && <div className="banner warn" style={{ margin: '6px 0 10px' }}>{tpl.note}</div>}
      {note && <p className="small muted">{note}</p>}
      {tpl?.sections.map(sec => {
        const items = agenda.items.filter(i => i.section === sec.key);
        if (!items.length && sec.key === 'loops') return null;
        return (
          <section key={sec.key} className="agenda-sec" aria-label={sec.title}>
            <h3 className="agenda-sec-title">{sec.title}</h3>
            {sec.hint && <p className="small muted" style={{ margin: '0 0 4px' }}>{sec.hint}</p>}
            <ul className="agenda-items">
              {items.map(i => (
                <li key={i.id} className={`agenda-item${i.done ? ' is-done' : ''}`}>
                  <input type="checkbox" checked={i.done} onChange={e => change(i.id, { done: e.target.checked })} aria-label={`Covered: ${i.text}`} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <textarea className="agenda-text" rows={1} ref={fit} value={i.text} onChange={e => { fit(e.target); change(i.id, { text: e.target.value }); }} aria-label="Agenda item" />
                    <div className="agenda-meta">
                      {(i.why || i.from === 'followup' || i.from === 'style') && (
                        <span className="small muted">{i.from === 'followup' ? 'Open follow-up' : i.from === 'style' ? 'For your leadership style' : `From your notes: ${i.why}`}</span>
                      )}
                      <button type="button" className={`agenda-priv${i.private ? ' on' : ''}`} aria-pressed={i.private} onClick={() => change(i.id, { private: !i.private })}
                        title={i.private ? 'Only you see this. Tap to include it when you share.' : 'Included when you share. Tap to keep it to yourself.'}>
                        <Icon name="key" size={12} /> {i.private ? 'Just you' : 'Shared'}
                      </button>
                      <button type="button" className="agenda-remove" onClick={() => remove(i.id)} aria-label={`Remove: ${i.text}`}><Icon name="x" size={14} /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {adding === sec.key ? (
              <form className="row" style={{ gap: 6, margin: '4px 0 0 30px' }} onSubmit={e => { e.preventDefault(); add(sec.key); }}>
                <input className="input" autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a topic or question"
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(null); } }} />
                <button className="btn small" type="submit">Add</button>
              </form>
            ) : (
              <button type="button" className="btn ghost small agenda-add" onClick={() => { setAdding(sec.key); setDraft(''); }}><Icon name="plus" size={14} /> Add</button>
            )}
          </section>
        );
      })}
      {err && <div className="banner error" role="alert">{err}</div>}
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn primary grow" onClick={startNotes}><Icon name="note" size={16} /> {agenda.entry_id ? 'Open notes' : 'Start notes'}</button>
        <button className="btn grow" onClick={copy}><Icon name="send" size={16} /> {copied ? 'Copied' : `Copy for ${first}`}</button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Copying leaves out {hiddenCount ? `the ${hiddenCount} item${hiddenCount === 1 ? '' : 's'} marked “Just you”` : 'anything marked “Just you”'}, so you can send {first} the agenda ahead of time and they can add to it.</p>
    </div>
  );
}
