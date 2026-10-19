import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import { fileIcon, fileSize, ACCEPT } from '../pages/AddFiles.jsx';
import { ApiError } from '../api.js';
import { PersonForm } from '../pages/People.jsx';
import { useApp } from '../lib/context.js';

/** The files attached to a note: thumbnails, what Heartwood read, and actions. */
/** Upload more files to an existing note. */
export async function attachFiles(entryId, list, { quiet = false } = {}) {
  const form = new FormData();
  if (quiet) form.append('meta', JSON.stringify({ quiet: true }));
  for (const f of list) form.append('files', f, f.name);
  const res = await fetch(`/api/entries/${entryId}/files`, { method: 'POST', body: form, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Upload failed (${res.status})`, res.status);
  return data;
}

export function FilesSection({ entry, onChange }) {
  const nav = useNavigate();
  const { notify } = useApp();
  const [stale, setStale] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null); // file id
  const [draft, setDraft] = useState('');
  const input = useRef();
  const files = entry.files || [];
  if (!files.length) return null;
  const reading = entry.status === 'processing';
  const failed = files.filter(f => f.status === 'error' && f.has_file);
  const stored = files.some(f => f.has_file);

  async function remove(f) {
    if (!confirm(`Remove “${f.name}” from this note? The file and what Heartwood read from it are deleted.`)) return;
    try { onChange(await api.del(`/files/${f.id}`)); setStale(true); }
    catch (e) { notify(e.message); }
  }

  async function saveNote(f) {
    const note = draft.trim();
    setEditing(null);
    if (note === (f.note || '')) return;
    try { onChange(await api.patch(`/files/${f.id}`, { note })); setStale(true); }
    catch (e) { notify(e.message); }
  }

  async function rewrite() {
    if (!confirm('Rewrite the note and reflection from the files on it now? Your own words at the top stay; the written summary below the line is replaced.')) return;
    try { onChange(await api.post(`/entries/${entry.id}/rewrite`)); setStale(false); }
    catch (e) { notify(e.message); }
  }

  async function addMore(list) {
    if (!list?.length) return;
    setUploading(true);
    try { onChange(await attachFiles(entry.id, list, { quiet: entry.source !== 'files' })); setStale(false); notify('Reading the new files…'); }
    catch (e) { notify(e.message); }
    finally { setUploading(false); }
  }

  async function split(f) {
    try { const r = await api.post(`/files/${f.id}/split`); nav(`/import/${r.id}`); }
    catch (e) { notify(e.message); }
  }

  return (
    <details className="section" open={reading || files.some(f => f.split_count && !f.split_done)}>
      <summary><Icon name="clip" size={18} /> {files.length} file{files.length > 1 ? 's' : ''}{reading ? ' · reading…' : ''}</summary>
      <div className="section-body stack" style={{ gap: 10 }}>
        {files.map(f => (
          <div key={f.id} className="coach" style={{ marginBottom: 0 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {f.kind === 'image' && f.has_file
                ? <a href={`/api/files/${f.id}`} target="_blank" rel="noopener"><img src={`/api/files/${f.id}`} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} /></a>
                : <Icon name={fileIcon(f.name)} size={22} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                <div className="small muted">
                  {fileSize(f.size)}
                  {f.status === 'pending' && <span className="status" style={{ marginLeft: 8 }}><span className="pulse" /> Reading</span>}
                  {f.status === 'error' && <span style={{ color: 'var(--rec-text)', marginLeft: 8 }}>Couldn’t read: {f.error}</span>}
                  {f.has_file && <> · <a href={`/api/files/${f.id}`} target="_blank" rel="noopener">Open</a></>}
                </div>
              </div>
              {!reading && <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => remove(f)} aria-label={`Remove ${f.name}`} title="Remove file"><Icon name="trash" size={17} /></button>}
            </div>
            {editing === f.id ? (
              <div className="row" style={{ marginTop: 8 }}>
                <input className="input" autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNote(f); if (e.key === 'Escape') setEditing(null); }}
                  placeholder="What’s this file? Who it’s from, when, why it matters" style={{ minHeight: 36, padding: '6px 10px', fontSize: 15 }} />
                <button className="btn small primary" onClick={() => saveNote(f)}>Save</button>
              </div>
            ) : f.note ? (
              <p className="small" style={{ margin: '8px 0 0', fontStyle: 'italic' }}>
                “{f.note}” {!reading && <button className="btn ghost small" style={{ minHeight: 24, padding: '0 6px' }} onClick={() => { setEditing(f.id); setDraft(f.note); }}>Edit</button>}
              </p>
            ) : !reading && (
              <button className="btn ghost small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => { setEditing(f.id); setDraft(''); }}>+ Add a note about this file</button>
            )}
            {f.split_count > 0 && !f.split_done && (
              <div className="banner info" style={{ margin: '10px 0 0' }}>
                <span className="grow small">This looks like a running log with {f.split_count} dated sections. Split it into separate entries so each one sits on its own date?</span>
                <button className="btn small" onClick={() => split(f)}>Review split</button>
              </div>
            )}
            {f.extracted_text && (
              <details style={{ marginTop: 8 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>What Heartwood read</summary>
                <div className="transcript" data-source={`file:${f.id}`} style={{ marginTop: 8, fontSize: 14 }}>{f.extracted_text}</div>
              </details>
            )}
          </div>
        ))}
        {stale && !reading && entry.source === 'files' && (
          <div className="banner warn" style={{ margin: 0 }}>
            <span className="grow small">Your files changed since the note was written. Rewrite it to include the changes.</span>
            <button className="btn small" onClick={rewrite}>Rewrite note</button>
          </div>
        )}
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={e => { addMore(e.target.files); e.target.value = ''; }} />
        <div className="row wrap">
          {!reading && <button className="btn small" onClick={() => input.current.click()} disabled={uploading}><Icon name="plus" size={16} /> {uploading ? 'Uploading…' : 'Add files'}</button>}
          {!reading && !stale && entry.source === 'files' && <button className="btn small" onClick={rewrite}><Icon name="retry" size={16} /> Rewrite note</button>}
          {failed.length > 0 && !reading && <button className="btn small" onClick={async () => onChange(await api.post(`/entries/${entry.id}/files/retry`))}><Icon name="retry" size={16} /> Retry failed</button>}
          {stored && !reading && <button className="btn small" onClick={async () => {
            if (!confirm('Delete the stored files? What Heartwood read from them stays with the note.')) return;
            onChange(await api.del(`/entries/${entry.id}/files`));
          }}>Delete files, keep text</button>}
        </div>
      </div>
    </details>
  );
}

const norm = s => s.toLowerCase().replace(/[^\p{L}\s'-]/gu, '').trim();

/** Names the AI found that aren't in People yet, with one tap to add them. */
export function SuggestedPeople({ entry, onLinked }) {
  const { people, refreshPeople } = useApp();
  const [adding, setAdding] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [myName, setMyName] = useState('');
  useEffect(() => { api.get('/settings').then(r => setMyName(r.settings.profile?.name || '')).catch(() => {}); }, []);
  const found = entry.analysis?.people || [];
  const known = people.map(p => norm(p.name));
  const knownFirst = people.map(p => norm(p.name).split(/\s+/)[0]);
  const me = norm(myName);
  const suggestions = [...new Set(found.map(String))].filter(n => {
    const x = norm(n);
    if (!x || ['me', 'i', 'team', 'the team'].includes(x) || (me && (x === me || x === me.split(/\s+/)[0])) || dismissed.includes(x)) return false;
    return !known.includes(x) && !(x.split(/\s+/).length === 1 && knownFirst.includes(x));
  }).slice(0, 8);
  if (!suggestions.length) return null;

  async function create(f) {
    const p = await api.post('/people', f);
    await refreshPeople();
    await onLinked([...entry.people.map(x => x.id), p.id]);
    setAdding(null);
  }

  return (
    <div className="mt" style={{ marginTop: 10 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>Also mentioned:</div>
      <div className="chips">
        {suggestions.map(n => (
          <span key={n} className="chip" style={{ paddingRight: 4 }}>
            <button onClick={() => setAdding(n)} style={{ border: 0, background: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}><Icon name="plus" size={13} /> {n}</button>
            <button onClick={() => setDismissed([...dismissed, norm(n)])} aria-label={`Dismiss ${n}`} style={{ border: 0, background: 'none', padding: '0 4px', color: 'inherit', cursor: 'pointer' }}><Icon name="x" size={12} /></button>
          </span>
        ))}
      </div>
      <Sheet open={!!adding} onClose={() => setAdding(null)} title="Add to People">
        {adding && <PersonForm key={adding} initial={{ name: adding }} compact onSubmit={create} submitLabel="Add and link to this note" />}
      </Sheet>
    </div>
  );
}
