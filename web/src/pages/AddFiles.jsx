import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { uploadFiles } from '../api.js';
import Icon from '../components/Icon.jsx';
import { PeoplePicker } from '../components/Pickers.jsx';
import { useApp } from '../lib/context.js';

export const ACCEPT = '.docx,.pdf,.pptx,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.md,.markdown,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/*';
const EXAMPLES = ['Meeting notes', 'Feedback or reviews', 'Plans and goals', 'Spreadsheets', 'Slide decks', 'Photos of whiteboards or sticky notes', 'Handwritten notes'];
const MAX_FILES = 20;
const OK_EXT = ACCEPT.split(',').filter(x => x.startsWith('.'));
const keyOf = f => `${f.name}-${f.size}`;

export function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) return 'image';
  if (['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (ext === 'pptx') return 'slides';
  return 'note';
}
export const fileSize = b => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export default function AddFiles() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { people } = useApp();
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState({});
  const [context, setContext] = useState('');
  const [who, setWho] = useState(() => (params.get('person') ? [params.get('person')] : []));
  const [picker, setPicker] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const input = useRef();

  function add(list) {
    const next = [...files];
    const skipped = [];
    for (const f of list) {
      if (!OK_EXT.includes(`.${f.name.split('.').pop().toLowerCase()}`)) { skipped.push(f.name); continue; }
      if (!next.some(x => x.name === f.name && x.size === f.size)) next.push(f);
    }
    if (skipped.length) setErr(`Can’t read ${skipped.join(', ')}. Supported: Word, PDF, PowerPoint, spreadsheets, text and photos.`);
    if (next.length > MAX_FILES) setErr(`Up to ${MAX_FILES} files per note.`);
    setFiles(next.slice(0, MAX_FILES));
  }

  async function submit() {
    setErr(''); setProgress(0);
    try {
      const e = await uploadFiles(files, { context: context.trim(), people: who, file_notes: files.map(f => (notes[keyOf(f)] || '').trim()) }, setProgress);
      nav(`/entry/${e.id}`, { replace: true });
    } catch (x) { setErr(x.message); setProgress(null); }
  }

  const selected = people.filter(p => who.includes(p.id));
  const busy = progress !== null;

  return (
    <main className="page no-tabs">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ fontSize: 24 }}>Add from files</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Give Heartwood more context about the people and projects around you. It reads the files, writes a note, reflects on it, and links the people involved.</p>
      <div className="chips mb">{EXAMPLES.map(x => <span key={x} className="chip" style={{ cursor: 'default' }}>{x}</span>)}</div>

      <div
        className="card"
        style={{ borderStyle: 'dashed', borderWidth: 1.5, borderColor: drag ? 'var(--accent)' : 'var(--line)', background: drag ? 'var(--accent-soft)' : 'var(--surface)', textAlign: 'center', padding: 20 }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
      >
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <button className="btn" onClick={() => input.current.click()} disabled={busy}><Icon name="clip" size={18} /> {files.length ? 'Add more files' : 'Choose files'}</button>
        <p className="small muted" style={{ margin: '10px 0 0' }}>Word, PDF, PowerPoint, Excel or CSV, text, and photos. Up to {MAX_FILES} files, 50 MB each.</p>
      </div>

      {files.length > 0 && (
        <div className="stack mt" style={{ gap: 6 }}>
          {files.map((f, i) => (
            <div key={keyOf(f)} className="card" style={{ padding: '8px 12px' }}>
              <div className="row">
                <Icon name={fileIcon(f.name)} size={20} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span className="small muted">{fileSize(f.size)}</span>
                {!busy && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label={`Remove ${f.name}`}><Icon name="x" size={16} /></button>}
              </div>
              <input className="input" style={{ minHeight: 36, padding: '6px 10px', fontSize: 15, marginTop: 6 }} disabled={busy}
                value={notes[keyOf(f)] || ''} onChange={e => setNotes({ ...notes, [keyOf(f)]: e.target.value })}
                placeholder="What’s this file? Who it’s from, when, why it matters" aria-label={`Note about ${f.name}`} />
            </div>
          ))}
        </div>
      )}

      <label className="field mt"><span>{files.length > 1 ? 'What is this all about?' : 'What is this?'} <small>(optional)</small></span>
        <textarea className="textarea" value={context} onChange={e => setContext(e.target.value)} disabled={busy}
          placeholder="What this is about and what you’d like Heartwood to help you see" />
      </label>

      <div className="field"><span>People <small>(optional)</small></span>
        <div className="chips">
          {selected.map(p => <span key={p.id} className="chip accent">{p.name}</span>)}
          <button className="chip" onClick={() => setPicker(true)} disabled={busy}><Icon name="plus" size={14} /> {who.length ? 'Edit' : 'Add people'}</button>
        </div>
        <small>Heartwood also finds people mentioned in the files and suggests adding them.</small>
      </div>

      {err && <div className="banner error" role="alert">{err}</div>}
      {busy && <div className="progress" style={{ maxWidth: 'none', marginBottom: 12 }}><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      <button className="btn primary block" disabled={!files.length || busy} onClick={submit}>
        {busy ? (progress < 1 ? 'Uploading…' : 'Opening note…') : 'Add note'}
      </button>

      <PeoplePicker open={picker} onClose={() => setPicker(false)} selected={who} onChange={setWho} />
    </main>
  );
}
