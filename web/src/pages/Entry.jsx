import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Editor, { appendMarkdown } from '../components/Editor.jsx';
import AnalysisPanel from '../components/AnalysisPanel.jsx';
import Sheet from '../components/Sheet.jsx';
import { PeoplePicker, TagEditor } from '../components/Pickers.jsx';
import { StatusBadge } from '../components/EntryItem.jsx';
import { FilesSection, SuggestedPeople, attachFiles } from '../components/EntryFiles.jsx';
import { ACCEPT } from './AddFiles.jsx';
import { KINDS, formatDate, duration } from '../lib/format.js';
import { useApp } from '../lib/context.js';
import { findRange, showRange, clearHighlight } from '../lib/highlight.js';

export default function Entry() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const fresh = params.get('fresh') === '1';
  const nav = useNavigate();
  const { notify, refreshPeople } = useApp();

  const [entry, setEntry] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sheet, setSheet] = useState(null); // 'people' | 'tags' | 'more'
  const [allTags, setAllTags] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saveState, setSaveState] = useState('');

  const dirty = useRef({ title: false, body: false });
  const latest = useRef({ title: '', body: '' });
  const saveTimer = useRef();
  const deleted = useRef(false);
  const [source, setSource] = useState(null); // where a follow-up came from (?hl=<followup id>)
  const [sourceFound, setSourceFound] = useState(true);
  const hl = params.get('hl');

  const applyServer = useCallback((e, { initial = false } = {}) => {
    setEntry(e);
    if (initial || (!dirty.current.title && e.title !== latest.current.title)) { setTitle(e.title); latest.current.title = e.title; }
    if (initial || (!dirty.current.body && e.body_md !== latest.current.body)) { setBody(e.body_md); latest.current.body = e.body_md; }
  }, []);

  useEffect(() => {
    api.get(`/entries/${id}`).then(e => applyServer(e, { initial: true })).catch(err => { notify(err.message); nav('/journal'); });
    api.get('/entries/tags').then(r => setAllTags(r.map(x => x.tag))).catch(() => {});
  }, [id, applyServer, nav, notify]);

  // Opened from a follow-up: find the passage it came from and highlight it.
  useEffect(() => {
    if (!hl) return;
    api.get(`/followups/${hl}/source`).then(setSource).catch(() => {});
    return () => clearHighlight();
  }, [hl]);
  const locate = useCallback(() => {
    if (!source) return false;
    if (source.where === 'reflection') {
      const el = document.querySelector('[data-source="reflection"]');
      if (!el) return false;
      for (let d = el.parentElement; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
      el.scrollIntoView({ block: 'center' });
      return true;
    }
    if (!source.where || !source.quote) return false;
    const root = document.querySelector(source.where === 'file' ? `[data-source="file:${source.file_id}"]` : `[data-source="${source.where}"]`);
    const ranges = (source.quotes?.length ? source.quotes : [source.quote]).map(q => findRange(root, q)).filter(Boolean);
    if (ranges.length) showRange(ranges);
    return ranges.length > 0;
  }, [source]);
  useEffect(() => {
    if (!source || !entry) return;
    // The editor and file list render after the entry arrives; try for a moment.
    let n = 0;
    const t = setInterval(() => { if (locate() || ++n > 12) { clearInterval(t); setSourceFound(n <= 12); } }, 150);
    // Typing in the note moves text around, so drop the highlight then.
    const off = () => clearHighlight();
    document.addEventListener('keydown', off, { once: true });
    return () => { clearInterval(t); document.removeEventListener('keydown', off); };
  }, [source, entry?.id, locate]);

  // Poll while the server is working on this entry
  useEffect(() => {
    if (!entry || !['transcribing', 'analyzing', 'processing'].includes(entry.status)) return;
    const t = setInterval(() => api.get(`/entries/${id}`).then(e => {
      applyServer(e);
      if (e.status === 'ready' || e.status === 'error') { setAnalyzing(false); refreshPeople(); }
    }).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [entry?.status, id, applyServer, refreshPeople]);

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (deleted.current || (!dirty.current.title && !dirty.current.body)) return;
    const patch = {};
    if (dirty.current.title) patch.title = latest.current.title;
    if (dirty.current.body) patch.body_md = latest.current.body;
    dirty.current = { title: false, body: false };
    setSaveState('Saving…');
    try {
      const e = await api.patch(`/entries/${id}`, patch);
      setEntry(prev => ({ ...prev, ...e, title: latest.current.title, body_md: latest.current.body }));
      setSaveState('Saved');
    } catch (err) {
      setSaveState('Not saved');
      notify(err.message);
      Object.keys(patch).forEach(k => (dirty.current[k === 'body_md' ? 'body' : 'title'] = true));
    }
  }, [id, notify]);

  const queueSave = () => { setSaveState(''); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 700); };
  const onTitle = v => { setTitle(v); latest.current.title = v; dirty.current.title = true; queueSave(); };
  const onBody = v => { latest.current.body = v; dirty.current.body = true; queueSave(); };

  // Save when leaving the page or backgrounding the app; remove notes left empty.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (fresh && !latest.current.title.trim() && !latest.current.body.trim() && !deleted.current) {
        api.del(`/entries/${id}`).catch(() => {});
      } else save();
    };
  }, [save, fresh, id]);

  async function patchNow(p) {
    try { applyServer(await api.patch(`/entries/${id}`, p)); } catch (e) { notify(e.message); }
  }

  async function runAnalysis() {
    await save();
    setAnalyzing(true);
    try { setEntry(await api.post(`/entries/${id}/analyze`)); }
    catch (e) { notify(e.message); setAnalyzing(false); }
  }

  function addTodos(items) {
    const md = items.map(x => `- [ ] ${x.text}${x.owner && x.owner.toLowerCase() !== 'me' ? ` (${x.owner})` : ''}${x.due ? ` — ${x.due}` : ''}`).join('\n');
    const next = appendMarkdown(latest.current.body, `## Follow-ups\n\n${md}`);
    setBody(next); onBody(next);
    notify('Added to your note');
  }

  function insertTranscript() {
    const next = appendMarkdown(latest.current.body, entry.transcript);
    setBody(next); onBody(next);
    notify('Transcript added to your note');
  }

  // Files pasted or dropped into the note are attached to it and read, like "Attach files".
  async function pasteFiles(list) {
    await save();
    try { applyServer(await attachFiles(id, list, { quiet: true })); notify(`Attached ${list.length === 1 ? list[0].name : `${list.length} files`}. Reading…`); }
    catch (x) { notify(x.message); }
  }

  async function remove() {
    if (!confirm('Delete this entry and its recording? This cannot be undone.')) return;
    deleted.current = true;
    await api.del(`/entries/${id}`);
    nav('/journal', { replace: true });
  }

  if (!entry) return <main className="page no-tabs" />;
  const people = entry.people || [];

  return (
    <main className="page no-tabs">
      <div className="sticky-top">
        <div className="topbar" style={{ marginBottom: 0 }}>
          <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
          <span className="small muted">{saveState}</span>
          <span className="spacer" />
          <StatusBadge status={entry.status} />
          <button className="icon-btn" onClick={() => setSheet('more')} aria-label="More"><Icon name="more" /></button>
        </div>
      </div>

      <h1 className="sr-only">{title || 'Untitled note'}</h1>
      <input className="title-input" aria-label="Title" placeholder={entry.status === 'transcribing' ? 'Transcribing… title comes next' : entry.status === 'processing' ? 'Reading files… title comes next' : 'Title'}
        value={title} onChange={e => onTitle(e.target.value)} autoFocus={fresh} />

      <div className="meta-bar">
        <span className="small muted">{formatDate(entry.created_at, { time: true })} · {KINDS[entry.kind]}</span>
      </div>
      <div className="chips">
        {people.map(p => <button key={p.id} className="chip accent" onClick={() => setSheet('people')}>{p.name}</button>)}
        <button className="chip" onClick={() => setSheet('people')}><Icon name="people" size={14} /> {people.length ? 'Edit' : 'People'}</button>
        {entry.tags.map(t => <button key={t} className="chip" onClick={() => setSheet('tags')}>#{t}</button>)}
        {entry.tags.length
          ? <button className="chip" onClick={() => setSheet('tags')} aria-label="Edit tags"><Icon name="plus" size={14} /></button>
          : <button className="chip" onClick={() => setSheet('tags')}># Tags</button>}
      </div>
      <SuggestedPeople entry={entry} onLinked={ids => patchNow({ people: ids })} />

      {entry.error && (
        <div className="banner error mt">
          <span className="grow">{entry.error}</span>
          {entry.source === 'files' && entry.status === 'error' && <button className="btn small" onClick={async () => applyServer(await api.post(`/entries/${id}/files/retry`))}><Icon name="retry" size={16} /> Retry</button>}
          {entry.source === 'import' && entry.status === 'error' && <button className="btn small" onClick={async () => { await api.post(`/entries/${id}/synthesize`); applyServer({ ...entry, status: 'analyzing', error: null }); }}><Icon name="retry" size={16} /> Retry</button>}
          {entry.has_audio && entry.status === 'error' && <button className="btn small" onClick={async () => setEntry(await api.post(`/entries/${id}/transcribe`))}><Icon name="retry" size={16} /> Retry</button>}
          <button className="icon-btn" onClick={() => patchNow({ clear_error: true })} aria-label="Dismiss"><Icon name="x" size={18} /></button>
        </div>
      )}

      {source && <SourceBanner source={source} found={sourceFound} onShow={locate} onClose={() => { clearHighlight(); setSource(null); }} />}

      <div className="mt" data-source="note">
        <Editor value={body} onChange={onBody} onFiles={['processing', 'transcribing', 'analyzing'].includes(entry.status) ? undefined : pasteFiles} placeholder={entry.status === 'processing' ? 'Reading your files… the note appears here.' : entry.has_audio ? 'Add your own notes…' : 'What’s on your mind?'} />
      </div>

      {(entry.has_audio || entry.transcript) && (
        <details className="section" open={!!entry.transcript && !body.trim()}>
          <summary><Icon name="wave" size={18} /> Recording{entry.audio_seconds ? ` · ${duration(entry.audio_seconds)}` : ''}</summary>
          <div className="section-body">
            {entry.has_audio && <audio controls preload="none" src={`/api/entries/${id}/audio`} />}
            {entry.status === 'transcribing' && <p className="status"><span className="pulse" /> Transcribing — you can leave this page.</p>}
            {entry.transcript && <>
              <div className="transcript" data-source="recording">{entry.transcript}</div>
              <div className="row wrap mt">
                <button className="btn small" onClick={insertTranscript}>Insert into note</button>
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(entry.transcript).then(() => notify('Copied'))}>Copy</button>
                {entry.has_audio && <button className="btn small" onClick={async () => { if (confirm('Transcribe again? This replaces the current transcript.')) setEntry(await api.post(`/entries/${id}/transcribe`)); }}>Re-transcribe</button>}
              </div>
            </>}
          </div>
        </details>
      )}

      <FilesSection entry={entry} onChange={e => applyServer(e)} />

      {entry.source === 'import' && (
        <details className="section">
          <summary><Icon name="journal" size={18} /> Original · {entry.source_name || 'imported document'}</summary>
          <div className="section-body">
            <div className="transcript" data-source="original">{entry.source_text}</div>
            <div className="row wrap mt">
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(entry.source_text).then(() => notify('Copied'))}>Copy</button>
              <button className="btn small" onClick={async () => {
                if (!confirm('Rewrite the note from the original text? This replaces the current note.')) return;
                await api.post(`/entries/${id}/synthesize`); applyServer({ ...entry, status: 'analyzing' });
              }}>Rewrite note from original</button>
            </div>
          </div>
        </details>
      )}

      <AnalysisPanel entry={entry} onRun={runAnalysis} onAddTodos={addTodos} busy={analyzing} />

      <PeoplePicker open={sheet === 'people'} onClose={() => setSheet(null)} selected={people.map(p => p.id)}
        onChange={ids => patchNow({ people: ids })} />
      <TagEditor open={sheet === 'tags'} onClose={() => setSheet(null)} tags={entry.tags} suggestions={allTags}
        onChange={tags => patchNow({ tags })} />

      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="Entry">
        <label className="field"><span>Type</span>
          <select className="select" value={entry.kind} onChange={e => patchNow({ kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>Date</span>
          <input className="input" type="datetime-local" value={toLocalInput(entry.created_at)}
            onChange={e => e.target.value && patchNow({ created_at: new Date(e.target.value).toISOString() })} />
        </label>
        {entry.has_audio && <button className="btn block mb" onClick={async () => {
          if (!confirm('Delete the audio file? The transcript and notes stay.')) return;
          applyServer(await api.del(`/entries/${id}/audio`)); setSheet(null);
        }}>Delete audio, keep transcript</button>}
        {!['processing', 'transcribing', 'analyzing'].includes(entry.status) && (
          <label className="btn block mb">
            <Icon name="clip" size={18} /> Attach files
            <input type="file" multiple accept={ACCEPT} hidden onChange={async e => {
              const list = e.target.files; if (!list?.length) return;
              await save();
              try { applyServer(await attachFiles(id, list)); setSheet(null); notify('Reading the files…'); }
              catch (x) { notify(x.message); }
              e.target.value = '';
            }} />
          </label>
        )}
        <button className="btn block danger" onClick={remove}><Icon name="trash" size={18} /> Delete entry</button>
      </Sheet>
    </main>
  );
}

const WHERE = { note: 'in your note', recording: 'in the transcript', original: 'in the original document', reflection: 'in the reflection’s follow-ups' };

/** Says which follow-up you came from and where it was found, with a way back to it. */
function SourceBanner({ source, found, onShow, onClose }) {
  const where = source.where === 'file' ? `in ${source.file_name || 'an attached file'}` : WHERE[source.where];
  const located = source.where && found;
  return (
    <div className="banner info source-banner" role="status">
      <Icon name="check" size={18} />
      <span className="grow small">
        <b>{source.text}</b><br />
        {located ? <>Highlighted {where}.{source.confident === false ? ' Closest match; it may be worded differently.' : ''}</>
          : source.quote ? <>Closest passage: “{source.quote.slice(0, 220)}{source.quote.length > 220 ? '…' : ''}”</>
            : 'Heartwood couldn’t pinpoint the passage, so it may have been inferred from the whole note.'}
      </span>
      {located && <button className="btn small ghost" onClick={onShow}>Show</button>}
      <button className="icon-btn" onClick={onClose} aria-label="Dismiss"><Icon name="x" size={16} /></button>
    </div>
  );
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
