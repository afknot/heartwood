import { useState } from 'react';
import { api, ApiError } from '../api.js';
import Icon from './Icon.jsx';

// Files and photos added to a question or an update: uploaded and read right away (so the AI can
// use them), shown as chips you can remove. Shared by Ask and "respond in your own words".

async function upload(list) {
  const form = new FormData();
  for (const f of list) form.append('files', f, f.name);
  const res = await fetch('/api/ask/attachments', { method: 'POST', body: form, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Upload failed (${res.status})`, res.status);
  return data;
}

export function useAttachments() {
  const [files, setFiles] = useState([]); // { key, name, kind, status: 'uploading'|'ready'|'error', id?, error? }
  async function attach(list) {
    const picked = [...(list || [])].slice(0, 8);
    if (!picked.length) return;
    const keyed = picked.map(f => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, kind: /^image\//.test(f.type) ? 'image' : 'file', status: 'uploading' }));
    setFiles(fs => [...fs, ...keyed]);
    try {
      const out = await upload(picked);
      setFiles(fs => fs.map(f => {
        const i = keyed.findIndex(k => k.key === f.key);
        if (i < 0) return f;
        const r = out[i] || {};
        return r.error || !r.id ? { ...f, status: 'error', error: r.error || 'Couldn’t read it' } : { ...f, status: 'ready', id: r.id, kind: r.kind };
      }));
    } catch (e) {
      setFiles(fs => fs.map(f => (keyed.some(k => k.key === f.key) ? { ...f, status: 'error', error: e.message } : f)));
    }
  }
  function remove(f) {
    setFiles(fs => fs.filter(x => x.key !== f.key));
    if (f.id) api.del(`/ask/attachments/${f.id}`).catch(() => {});
  }
  const ready = files.filter(f => f.status === 'ready');
  return {
    files, attach, remove, ready,
    uploading: files.some(f => f.status === 'uploading'),
    clear: () => setFiles([]),
    sent: () => ready.map(f => ({ id: f.id, name: f.name, kind: f.kind }))
  };
}

export function AttachmentChips({ files, onRemove }) {
  if (!files.length) return null;
  return files.map(f => (
    <span key={f.key} className={`chip small-chip${f.status === 'error' ? ' chip-error' : ''}`} title={f.error || f.name}>
      {f.status === 'uploading' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name={f.kind === 'image' ? 'image' : 'clip'} size={13} />}
      <span className="chip-name">{f.status === 'error' ? `${f.name}: ${f.error}` : f.name}</span>
      <button type="button" className="chip-x" onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`}><Icon name="x" size={12} /></button>
    </span>
  ));
}
