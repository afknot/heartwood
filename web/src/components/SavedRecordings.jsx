import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { listPending, flushPending, removePending, uploadStatus } from '../lib/pending.js';
import { KINDS, duration } from '../lib/format.js';
import { useApp } from '../lib/context.js';

/** Recordings kept on this phone until they reach your server, with live upload progress. */
export default function SavedRecordings({ onUploaded }) {
  const { people, notify } = useApp();
  const [items, setItems] = useState([]);
  const [st, setSt] = useState(uploadStatus());
  const [online, setOnline] = useState(navigator.onLine);
  const refresh = () => listPending().then(l => setItems(l.filter(p => !p.draft && p.blob))).catch(() => {});
  useEffect(() => {
    refresh();
    const onSt = e => {
      setSt(e.detail);
      // Something finished or changed: re-read what's still on the phone.
      setItems(cur => { if (cur.some(i => !e.detail[i.id])) { refresh(); onUploaded?.(); } return cur; });
    };
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('heartwood:uploads', onSt);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('heartwood:uploads', onSt); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!items.length) return null;

  const name = id => people.find(p => p.id === id)?.name.split(' ')[0];
  const label = i => {
    const m = i.meta || {};
    const who = (m.people || []).map(name).filter(Boolean);
    return m.title || [KINDS[m.kind] || 'Recording', who.length ? `with ${who.join(', ')}` : ''].filter(Boolean).join(' ');
  };
  const when = i => {
    const t = new Date(i.meta?.recorded_at || i.created || Date.now());
    return t.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const uploading = items.some(i => st[i.id]?.state === 'uploading');
  const allFailed = items.every(i => st[i.id]?.state === 'failed' || i.error);
  async function now() { await flushPending(); refresh(); }
  async function discard(i) {
    if (!confirm('Delete this recording from your phone? It never reached your server, so it can’t be recovered.')) return;
    await removePending(i.id); refresh(); notify('Deleted');
  }
  return (
    <section className="card saved-recs mt" aria-label="Recordings uploading">
      <div className="row" style={{ gap: 8 }}>
        <Icon name="mic" size={18} />
        <b className="grow">{uploading ? 'Uploading' : allFailed ? 'Couldn’t upload' : online ? 'Ready to upload' : 'Waiting for a connection'}</b>
        {!uploading && !allFailed && online && <button className="btn small" onClick={now}>Upload now</button>}
      </div>
      <p className="small muted" style={{ margin: '2px 0 8px' }}>Safe on this phone until they reach your server{online ? '' : '. They’ll upload on their own when you’re back online'}.</p>
      <ul className="saved-list">
        {items.map(i => {
          const s = st[i.id] || {};
          const pct = Math.round((s.progress || 0) * 100);
          return (
            <li key={i.id}>
              <div className="row" style={{ gap: 8 }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="saved-title">{label(i)}</span>
                  <span className="small muted"> · {when(i)}{i.meta?.seconds ? ` · ${duration(i.meta.seconds)}` : ''} · {(i.blob.size / 1048576).toFixed(i.blob.size > 1e7 ? 0 : 1)} MB</span>
                </span>
                <span className={`small saved-state ${s.state || 'waiting'}`}>
                  {s.state === 'uploading' ? `${pct}%` : s.state === 'failed' ? 'Didn’t upload' : online ? 'Next up' : 'Waiting'}
                </span>
              </div>
              {s.state === 'uploading' && <div className="saved-bar on" role="progressbar" aria-label={`Uploading ${label(i)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${Math.max(2, pct)}%` }} /></div>}
              {s.state === 'failed' && (
                <div className="row small" style={{ gap: 8, marginTop: 4 }}>
                  <span className="grow muted">{s.error}</span>
                  <button className="btn small ghost" onClick={() => discard(i)}>Delete</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
