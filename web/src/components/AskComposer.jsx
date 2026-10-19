import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAttachments, AttachmentChips } from './Attachments.jsx';
import { pastedFiles, dropProps } from '../lib/pasteFiles.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import Avatar from './Avatar.jsx';
import { ACCEPT } from '../pages/AddFiles.jsx';
import { useApp } from '../lib/context.js';

// The Ask composer: type, @-mention a person, note or recurring meeting, attach files and photos,
// or say your question out loud (it's transcribed into the box so you can fix it before sending).

const TYPE_ICON = { person: 'people', entry: 'note', schedule: 'repeat', meeting: 'calendar' };
const TYPE_LABEL = { person: 'Person', entry: 'Note', schedule: 'Recurring', meeting: 'Meeting' };
const fileIcon = kind => (kind === 'image' ? 'image' : 'clip');
// "2025-04-28" → "Apr 28, 2025"; anything else passes through.
const when = sub => String(sub || '').replace(/\b(\d{4}-\d{2}-\d{2})\b/g, d => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/** "@Mai" right before the caret → "Mai" (allows one space, for full names). */
function mentionAt(text, caret) {
  const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/);
  return m ? { query: m[1], start: caret - m[1].length - 1 } : null;
}

export default function AskComposer({ busy, placeholder, onSend }) {
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [refs, setRefs] = useState([]); // { type, id, label }
  const att = useAttachments();
  const { files, attach } = att;
  const [over, setOver] = useState(false);
  const [suggest, setSuggest] = useState(null); // { query, start, items, index }
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [rec, setRec] = useState(null); // { started } while recording
  const [transcribing, setTranscribing] = useState(false);
  const [secs, setSecs] = useState(0);
  const ta = useRef();
  const fileInput = useRef();
  const camInput = useRef();
  const recorder = useRef(null);
  const timer = useRef();

  const grow = () => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(160, el.scrollHeight)}px`; el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden'; } };
  useEffect(grow, [text]);

  // @ suggestions, fetched as you type.
  useEffect(() => {
    if (!suggest) return;
    const t = setTimeout(() => {
      api.get(`/ask/suggest?q=${encodeURIComponent(suggest.query)}`)
        .then(items => setSuggest(s => (s && s.query === suggest.query ? { ...s, items, index: 0 } : s))).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [suggest?.query]);

  function onChange(e) {
    setText(e.target.value);
    const m = mentionAt(e.target.value, e.target.selectionStart);
    setSuggest(m ? s => ({ items: s?.items || [], index: 0, ...m }) : null);
  }

  function addRef(item) {
    setRefs(rs => (rs.some(r => r.type === item.type && r.id === item.id) ? rs : [...rs, { type: item.type, id: item.id, label: item.label }]));
  }
  function choose(item) {
    if (!item) return;
    addRef(item);
    if (suggest) {
      const caret = ta.current?.selectionStart ?? text.length;
      const next = `${text.slice(0, suggest.start)}@${item.label} ${text.slice(caret)}`;
      setText(next);
      const pos = suggest.start + item.label.length + 2;
      requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); });
    }
    setSuggest(null);
  }

  function onKeyDown(e) {
    if (suggest?.items?.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggest(s => ({ ...s, index: (s.index + 1) % s.items.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSuggest(s => ({ ...s, index: (s.index - 1 + s.items.length) % s.items.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggest.items[suggest.index]); return; }
    }
    if (e.key === 'Escape' && suggest) { e.preventDefault(); setSuggest(null); return; }
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); }
  }

  // ---------- voice ----------
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify('Voice input isn’t supported in this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      r.ondataavailable = e => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timer.current);
        setRec(null);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        if (blob.size < 1500) return;
        setTranscribing(true);
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
          const form = new FormData();
          form.append('audio', blob, `question.${ext}`);
          const res = await fetch('/api/ask/dictate', { method: 'POST', body: form, credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Couldn’t transcribe that.');
          if (data.text) setText(t => (t.trim() ? `${t.trimEnd()} ${data.text}` : data.text));
          requestAnimationFrame(() => ta.current?.focus());
        } catch (e) { notify(e.message); }
        finally { setTranscribing(false); }
      };
      recorder.current = r;
      r.start();
      setSecs(0);
      const started = Date.now();
      timer.current = setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        setSecs(s);
        if (s >= 300) r.state === 'recording' && r.stop(); // five minutes is plenty for a question
      }, 500);
      setRec({ started });
    } catch {
      notify('Heartwood needs microphone access for voice input.');
    }
  }
  const stopRec = () => recorder.current?.state === 'recording' && recorder.current.stop();
  useEffect(() => () => { clearInterval(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop(); }, []);

  const { uploading, ready } = att;
  const canSend = !busy && !uploading && !rec && !transcribing && (text.trim() || ready.length);

  function send() {
    if (!canSend) return;
    onSend({ question: text.trim(), refs, attachments: att.sent() });
    setText(''); setRefs([]); att.clear(); setSuggest(null);
  }

  const items = suggest?.items || [];
  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); send(); }} {...dropProps(attach, setOver)}>
      <div className={`composer-box${over ? ' drop-over' : ''}`}>
        {suggest && items.length > 0 && (
          <div className="ask-suggest" role="listbox" aria-label="Mention a person, meeting or note">
            {items.map((it, i) => (
              <button type="button" key={`${it.type}-${it.id}`} role="option" aria-selected={i === suggest.index}
                className={`mention-item ask-item${i === suggest.index ? ' on' : ''}`} onMouseDown={e => { e.preventDefault(); choose(it); }}>
                {it.type === 'person' ? <Avatar person={{ id: it.id, name: it.label, photo: it.photo }} size={26} /> : <span className="ask-item-ic"><Icon name={TYPE_ICON[it.type]} size={15} /></span>}
                <span className="grow"><span className="ask-item-label">{it.label}</span><small>{TYPE_LABEL[it.type]}{it.sub ? ` · ${when(it.sub)}` : ''}</small></span>
              </button>
            ))}
          </div>
        )}

        {(refs.length > 0 || files.length > 0) && (
          <div className="composer-chips">
            {refs.map(r => (
              <span key={`${r.type}-${r.id}`} className="chip accent small-chip">
                <Icon name={TYPE_ICON[r.type]} size={13} /> {r.label}
                <button type="button" className="chip-x" onClick={() => setRefs(rs => rs.filter(x => x !== r))} aria-label={`Remove ${r.label}`}><Icon name="x" size={12} /></button>
              </span>
            ))}
            <AttachmentChips files={files} onRemove={att.remove} />
          </div>
        )}

        <div className="composer-inner">
          <button type="button" className="icon-btn ghost-btn" onClick={() => setMenu(true)} aria-label="Add a file, photo, person, note or meeting" disabled={!!rec}><Icon name="plus" /></button>
          {rec ? (
            <div className="rec-pill" role="status"><span className="pulse" /> Listening… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</div>
          ) : (
            <textarea ref={ta} className="textarea" rows={1} aria-label="Message" value={text}
              placeholder={transcribing ? 'Transcribing…' : placeholder} disabled={transcribing}
              onChange={onChange} onKeyDown={onKeyDown}
              onPaste={e => { const f = pastedFiles(e); if (f.length) { e.preventDefault(); attach(f); } }}
              onBlur={() => setTimeout(() => setSuggest(null), 150)} />
          )}
          {rec
            ? <button type="button" className="icon-btn rec-btn" onClick={stopRec} aria-label="Stop and transcribe"><Icon name="stop" /></button>
            : !text.trim() && !ready.length
              ? <button type="button" className="icon-btn ghost-btn" onClick={startRec} disabled={transcribing || busy} aria-label="Ask by voice">{transcribing ? <span className="spinner" /> : <Icon name="mic" />}</button>
              : <button className="icon-btn" disabled={!canSend} aria-label="Send"><Icon name="send" /></button>}
        </div>
      </div>

      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={e => { attach(e.target.files); e.target.value = ''; }} />
      <input ref={camInput} type="file" accept="image/*" capture="environment" hidden onChange={e => { attach(e.target.files); e.target.value = ''; }} />

      <Sheet open={menu} onClose={() => setMenu(false)} title="Add to your question">
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); fileInput.current?.click(); }}>
            <Icon name="clip" size={18} /> Files or photos
          </button>
          <button type="button" className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); camInput.current?.click(); }}>
            <Icon name="camera" size={18} /> Take a photo
          </button>
          <button type="button" className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); setPicker(true); }}>
            <Icon name="people" size={18} /> A person, meeting or note
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Tip: type @ in your question to mention someone or something, or paste or drop files right into the box. Documents, decks, spreadsheets, PDFs and photos all work, including whiteboards and handwriting.</p>
      </Sheet>
      <RefPicker open={picker} onClose={() => setPicker(false)} chosen={refs} onPick={it => addRef(it)} />
    </form>
  );
}

/** Search for people, recurring meetings and notes to point Ask at. */
function RefPicker({ open, onClose, chosen, onPick }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api.get(`/ask/suggest?q=${encodeURIComponent(q.trim())}`).then(setItems).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const has = it => chosen.some(r => r.type === it.type && r.id === it.id);
  const groups = ['person', 'meeting', 'schedule', 'entry'].map(t => [t, items.filter(i => i.type === t)]).filter(([, l]) => l.length);
  return (
    <Sheet open={open} onClose={onClose} title="Point Ask at…">
      <div className="search" style={{ marginBottom: 10 }}><Icon name="search" size={18} />
        <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people, meetings and notes" aria-label="Search" />
      </div>
      {groups.map(([t, list]) => (
        <div key={t}>
          <div className="day-label" style={{ margin: '10px 0 4px' }}>{{ person: 'People', meeting: 'Meetings', schedule: 'Recurring 1:1s', entry: q ? 'Notes' : 'Recent notes' }[t]}</div>
          {list.map(it => (
            <button type="button" key={it.id} className={`mention-item ask-item${has(it) ? ' on' : ''}`} aria-pressed={has(it)} onClick={() => onPick(it)}>
              {it.type === 'person' ? <Avatar person={{ id: it.id, name: it.label, photo: it.photo }} size={28} /> : <span className="ask-item-ic"><Icon name={TYPE_ICON[it.type]} size={15} /></span>}
              <span className="grow"><span className="ask-item-label">{it.label}</span>{it.sub && <small>{when(it.sub)}</small>}</span>
              {has(it) && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      ))}
      {!groups.length && <p className="muted small">Nothing matches.</p>}
      <button type="button" className="btn primary block mt" onClick={onClose}>Done</button>
    </Sheet>
  );
}
