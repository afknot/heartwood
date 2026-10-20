import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import Avatar from './Avatar.jsx';
import { PeoplePicker } from './Pickers.jsx';
import { useApp } from '../lib/context.js';
import { whenLong, theirTimes } from './Occurrence.jsx';
import ContextBar from './ContextBar.jsx';

/**
 * A meeting from your calendar or an invite: who's in it (set by hand or matched automatically),
 * linking attendees to people so future meetings match, plus prep and notes.
 * `uid` identifies the series; `ev` (optional) is the specific occurrence from Today.
 */
export function MeetingSheet({ uid, ev, onClose, onChanged, onPrep }) {
  const nav = useNavigate();
  const { people, notify, refreshPeople } = useApp();
  const [m, setM] = useState(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setM(null);
    if (uid) api.get(`/meetings/${encodeURIComponent(uid)}`).then(setM).catch(e => notify(e.message));
  }, [uid, notify]);
  if (!uid) return null;
  const path = `/meetings/${encodeURIComponent(uid)}`;
  const chosen = m?.people || [];
  const ids = chosen.map(p => p.id);
  const kind = ids.length === 1 ? 'one_on_one' : 'meeting';
  const start = ev?.start || m?.start;
  const there = start ? theirTimes(chosen, start) : '';

  async function save(body) {
    setBusy(true);
    try { setM(await api.put(`${path}/people`, body)); onChanged?.(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  async function link(i, personId) {
    if (!personId) return;
    setBusy(true);
    try {
      const r = await api.post(`${path}/attendee`, { i, person_id: personId });
      setM(r); refreshPeople(); onChanged?.();
      const name = people.find(p => p.id === personId)?.name.split(' ')[0];
      notify(r.replaced_email ? `Updated ${name}’s email to match this invite` : `Linked to ${name}. Future meetings will match.`);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  async function writeNote() {
    const e = await api.post('/entries', { kind, people: ids, title: m.title });
    nav(`/entry/${e.id}?fresh=1`);
  }
  const unlinked = (m?.attendees || []).filter(a => !a.person_id);

  return (
    <Sheet open onClose={onClose} title={m?.title || ev?.title || 'Meeting'}>
      {start && <p className="small muted" style={{ marginTop: -8 }}>{whenLong(start)}{there && <><br />{there}</>}</p>}
      {!m ? <p className="muted"><span className="spinner" /> Loading…</p> : <>
        <div className="field"><span>People in this meeting <small>({m.set_by_hand ? 'set by you' : 'matched automatically'})</small></span>
          <div className="chips">
            {chosen.map(p => <Link key={p.id} to={`/people/${p.id}`} onClick={onClose} className="chip accent" style={{ paddingLeft: 4 }}><Avatar person={p} size={22} /> {p.name}</Link>)}
            <button type="button" className="chip" onClick={() => setPicker(true)} disabled={busy}><Icon name="plus" size={14} /> {chosen.length ? 'Edit' : 'Add people'}</button>
          </div>
          <small>Applies to every meeting in this series.{m.set_by_hand && <> <button type="button" className="linklike" onClick={() => save({ automatic: true })}>Go back to automatic</button></>}</small>
        </div>

        {unlinked.length > 0 && <div className="field"><span>Others on the invite</span>
          {unlinked.map(a => (
            <div key={a.i} className="row" style={{ gap: 8, padding: '4px 0' }}>
              <span className="grow small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <select className="select" style={{ width: 'auto', maxWidth: '55%' }} value="" disabled={busy} onChange={e => link(a.i, e.target.value)} aria-label={`Who is ${a.name}?`}>
                <option value="">This is…</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
          <small>Linking saves their invite address on that person, so Heartwood recognizes them in every meeting.</small>
        </div>}

        {ev && chosen.length > 0 && <>
          <button className="btn primary block" onClick={() => { onClose(); onPrep({ ...ev, people: chosen }); }}><Icon name="sparkle" size={18} /> {ev.prep ? 'Open prep' : 'Prep'}</button>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <Link className="btn rec" style={{ flex: 1 }} to={`/record?kind=${kind}&person=${ids.join(',')}${kind === 'meeting' && (m?.title || ev?.title || '') ? `&title=${encodeURIComponent((m?.title || ev?.title || ''))}` : ''}`}><Icon name="mic" size={18} /> Record</Link>
            <button className="btn" style={{ flex: 1 }} onClick={writeNote}><Icon name="note" size={18} /> Write notes</button>
          </div>
        </>}
        <ContextBar subject={{ kind: 'meeting', id: uid, label: m.title || ev?.title || 'this meeting' }} recipients={chosen} compact />
      </>}
      <PeoplePicker open={picker} onClose={() => setPicker(false)} selected={ids} onChange={next => save({ people: next })} />
    </Sheet>
  );
}
