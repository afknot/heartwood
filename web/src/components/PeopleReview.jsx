import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Sheet from './Sheet.jsx';
import { PersonForm } from '../pages/People.jsx';
import { useApp } from '../lib/context.js';

const REL = { direct_report: 'on your team', peer: 'peer', manager: 'your manager', mentor: 'mentor', mentee: 'mentee', stakeholder: 'stakeholder' };

/**
 * "Who was in this?" Once a recording or files are read: the people Heartwood found, to confirm in one go.
 * Shows until you press Done. Later hides it until you next open the note.
 */
export default function PeopleReview({ entry, onSaved, onShow }) {
  const { notify, refreshPeople } = useApp();
  const [r, setR] = useState(null);
  const [pick, setPick] = useState({}); // person id -> 'with' | 'mentioned' | 'no'
  const [added, setAdded] = useState([]); // people created from new names
  const [skip, setSkip] = useState([]);
  const [adding, setAdding] = useState(null);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/entries/${entry.id}/people-review`).then(x => {
      setR(x);
      setPick(Object.fromEntries(x.people.map(p => [p.id, p.link || 'mentioned'])));
    }).catch(() => {});
  }, [entry.id, entry.status, entry.analysis_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const showing = !!r?.show && !later;
  useEffect(() => { onShow?.(showing); }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!showing) return null;
  const solo = ['memo', 'note'].includes(entry.kind);
  const IN = solo ? 'About them' : 'In it';
  const rows = [...r.people, ...added];
  const pendingNew = r.new_names.filter(n => !skip.includes(n) && !added.some(a => a.from === n));
  const pendingAmb = (r.ambiguous || []).filter(a => !skip.includes(a.name) && !added.some(x => x.from === a.name));
  // "Sam: which one?" Picking one adds them as a row you can then set to In it or Mentioned.
  const choose = (name, p) => {
    setAdded(a => [...a, { ...p, from: name, found: true }]);
    setPick(x => ({ ...x, [p.id]: 'mentioned' }));
  };

  async function create(f) {
    try {
      const p = await api.post('/people', f);
      await refreshPeople();
      setAdded(a => [...a, { id: p.id, name: p.name, role: p.role || '', relationship: p.relationship || '', from: adding, found: true }]);
      setPick(x => ({ ...x, [p.id]: 'mentioned' }));
      setAdding(null);
    } catch (e) { notify(e.message); }
  }

  async function done() {
    setBusy(true);
    try {
      const ids = k => rows.filter(p => pick[p.id] === k).map(p => p.id);
      const res = await api.post(`/entries/${entry.id}/people-review`, { with: ids('with'), mentioned: ids('mentioned'), skip: [...skip, ...pendingNew, ...pendingAmb.map(a => a.name)] });
      onSaved(res.entry);
      const n = ids('with').length + ids('mentioned').length;
      notify(n ? `Linked ${n} ${n === 1 ? 'person' : 'people'} to this note` : 'Saved');
      setR(res.review);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="card people-review" aria-labelledby="pr-head">
      <h2 id="pr-head" style={{ margin: 0, fontSize: 17 }}>Who was in this?</h2>
      <p className="small muted" style={{ margin: '2px 0 10px' }}>
        {solo ? 'Heartwood found these names. Pick who it’s about and who’s only mentioned.' : 'Heartwood found these names. Pick who was in the conversation and who was only mentioned.'}
        {' '}People in it count as time together on Team and Today.
      </p>
      <ul className="pr-list">
        {rows.map(p => (
          <li key={p.id}>
            <span className="grow"><b>{p.name}</b>{(p.role || REL[p.relationship]) && <small>{p.role || REL[p.relationship]}</small>}</span>
            <div className="seg small-seg" role="group" aria-label={`${p.name}`}>
              {[['with', IN], ['mentioned', 'Mentioned'], ['no', 'Not them']].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={pick[p.id] === k} className={pick[p.id] === k ? 'on' : ''} onClick={() => setPick(x => ({ ...x, [p.id]: k }))}>{label}</button>
              ))}
            </div>
          </li>
        ))}
        {pendingAmb.map(a => (
          <li key={`amb:${a.name}`} className="pr-amb">
            <span className="grow"><b>{a.name}: which one?</b><small>{a.options.length} people in People are called {a.name}</small></span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label={`Which ${a.name}`}>
              {a.options.map(p => (
                <button key={p.id} type="button" className="btn small" onClick={() => choose(a.name, p)}>
                  {p.name}{(p.role || REL[p.relationship]) ? <span className="muted"> · {p.role || REL[p.relationship]}</span> : null}
                </button>
              ))}
              <button type="button" className="btn small ghost" onClick={() => setSkip(s => [...s, a.name])}>Someone else</button>
            </div>
          </li>
        ))}
        {pendingNew.map(n => (
          <li key={`new:${n}`}>
            <span className="grow"><b>{n}</b><small>Not in People</small></span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small" onClick={() => setAdding(n)}>Add to People</button>
              <button type="button" className="btn small ghost" onClick={() => setSkip(s => [...s, n])} aria-label={`Skip ${n}`}>Skip</button>
            </div>
          </li>
        ))}
      </ul>
      {skip.length > 0 && <p className="small muted" style={{ margin: '6px 0 0' }}>Skipped: {skip.join(', ')}. <button type="button" className="linklike" onClick={() => setSkip([])}>Undo</button></p>}
      <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn small ghost" onClick={() => setLater(true)}>Later</button>
        <button type="button" className="btn small primary" onClick={done} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>Names you don’t add or pick are skipped and won’t be suggested for this note again.</p>
      <Sheet open={!!adding} onClose={() => setAdding(null)} title="Add to People">
        {adding && <PersonForm key={adding} initial={{ name: adding }} compact onSubmit={create} submitLabel="Add" />}
      </Sheet>
    </section>
  );
}
