import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Sheet from './Sheet.jsx';
import { VoiceTextarea } from './VoiceInput.jsx';
import { useApp } from '../lib/context.js';

const MODES = [
  { k: 'new', label: 'Draft', hint: 'What do you want to get across? Rough notes are fine, or say it out loud.' },
  { k: 'improve', label: 'Improve my draft', hint: 'Paste or dictate your draft.' },
  { k: 'reply', label: 'Reply', hint: 'Roughly what you want to say back (optional).' }
];
const CHANNELS = [{ k: 'email', label: 'Email' }, { k: 'slack', label: 'Slack / Teams' }, { k: 'text', label: 'Text' }];
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } }
};

/** Write a message to someone in your own words: draft, improve your draft, or reply. Never sends. */
export function ComposeSheet({ open, onClose, subject, recipients = [], onSent }) {
  const { notify } = useApp();
  const [mode, setMode] = useState('new');
  const [channel, setChannel] = useState(() => store.get('hw:compose-channel', 'email'));
  const [text, setText] = useState('');
  const [their, setTheir] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null); // { variants, changes, flags, recipients, audience }
  const [pick, setPick] = useState(0);
  const [edits, setEdits] = useState({}); // index -> { subject, text }
  const [log, setLog] = useState(true);
  const [voice, setVoice] = useState(null);
  useEffect(() => {
    if (!open) return;
    setOut(null); setEdits({}); setPick(0); setText(''); setTheir('');
    api.get('/voice').then(setVoice).catch(() => setVoice(null));
  }, [open, subject?.id]);
  useEffect(() => store.set('hw:compose-channel', channel), [channel]);

  const to = recipients.map(p => p.name.split(' ')[0]).join(', ') || subject?.label;
  const learned = voice ? voice.counts.exercise + voice.counts.example + voice.counts.edited : 0;

  async function write() {
    setBusy(true);
    try {
      const r = await api.post('/compose', { subject: { kind: subject.kind, id: subject.id }, mode, channel, text, their });
      setOut(r); setPick(0); setEdits({});
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  }
  const cur = out ? { ...out.variants[pick], ...(edits[pick] || {}) } : null;
  const edit = patch => setEdits(e => ({ ...e, [pick]: { ...out.variants[pick], ...(e[pick] || {}), ...patch } }));
  async function used() {
    const v = out.variants[pick];
    const subjects = [{ kind: subject.kind, id: subject.id }, ...recipients.filter(p => !(subject.kind === 'person' && p.id === subject.id)).map(p => ({ kind: 'person', id: p.id }))];
    const r = await api.post('/compose/used', { text: cur.text, original: v.text, channel, audience: out.audience, log, subjects, subject_line: cur.subject }).catch(() => null);
    if (r?.learned) notify('Copied. Your edits will help future drafts sound like you.');
    if (log) onSent?.();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(channel === 'email' && cur.subject ? `Subject: ${cur.subject}\n\n${cur.text}` : cur.text); notify('Copied'); }
    catch { notify('Couldn’t copy. Select the text and copy it instead.'); return; }
    used();
  }
  function mail() {
    const addr = (out.recipients || []).map(p => p.email).filter(Boolean).join(',');
    used();
    window.location.href = `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(cur.subject || '')}&body=${encodeURIComponent(cur.text)}`;
  }

  return (
    <Sheet open={open} onClose={onClose} title={to ? `Write to ${to}` : 'Write a message'}>
      {!out ? <>
        <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
          {MODES.map(m => <button key={m.k} role="tab" aria-selected={mode === m.k} className={mode === m.k ? 'on' : ''} onClick={() => setMode(m.k)}>{m.label}</button>)}
        </div>
        <div className="chips" role="radiogroup" aria-label="Where it’s going" style={{ marginBottom: 12 }}>
          {CHANNELS.map(c => <button key={c.k} type="button" role="radio" aria-checked={channel === c.k} className={`chip${channel === c.k ? ' on' : ''}`} onClick={() => setChannel(c.k)}>{c.label}</button>)}
        </div>
        {mode === 'reply' && (
          <label className="field"><span>Their message</span>
            <textarea className="textarea" rows={4} value={their} onChange={e => setTheir(e.target.value)} placeholder="Paste the email or message you’re replying to" />
          </label>
        )}
        <div className="field"><span>{mode === 'improve' ? 'Your draft' : mode === 'reply' ? 'What you want to say' : 'What you want to say'}</span>
          <VoiceTextarea value={text} onChange={setText} rows={mode === 'improve' ? 6 : 4} placeholder={MODES.find(m => m.k === mode).hint} label="Message input" />
        </div>
        {voice && learned < 3 && (
          <div className="banner" style={{ marginBottom: 10 }}>
            <span className="grow small">Drafts sound more like you after a few writing exercises. It takes about five minutes.</span>
            <Link className="btn small" to="/you/voice" onClick={onClose}>Teach your voice</Link>
          </div>
        )}
        <button className="btn primary block" onClick={write} disabled={busy || (mode === 'reply' ? !their.trim() : !text.trim())}>
          {busy ? <><span className="spinner" /> Writing in your voice…</> : mode === 'improve' ? 'Improve it' : 'Write it'}
        </button>
        <p className="small muted" style={{ marginBottom: 0 }}>Heartwood uses your notes about {to || 'them'} for background and never sends anything. You copy it or open it in your mail app.</p>
      </> : <>
        {out.variants.length > 1 && (
          <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
            {out.variants.map((v, i) => <button key={i} role="tab" aria-selected={pick === i} className={pick === i ? 'on' : ''} onClick={() => setPick(i)}>{v.label}</button>)}
          </div>
        )}
        {out.flags.length > 0 && (
          <div className="banner warn" role="alert" style={{ marginBottom: 10 }}>
            <span className="grow small"><b>Check before sending:</b> {out.flags.join(' ')}</span>
          </div>
        )}
        {channel === 'email' && (
          <label className="field"><span>Subject</span><input className="input" value={cur.subject} onChange={e => edit({ subject: e.target.value })} /></label>
        )}
        <label className="field"><span>Message <small>(edit freely)</small></span>
          <textarea className="textarea compose-text" rows={10} value={cur.text} onChange={e => edit({ text: e.target.value })} />
        </label>
        {out.changes.length > 0 && (
          <details className="small" style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer' }}>What changed from your draft</summary>
            <ul className="compose-changes">{out.changes.map((c, i) => <li key={i}><b>{c.what}</b>{c.why ? ` · ${c.why}` : ''}</li>)}</ul>
          </details>
        )}
        <label className="compose-log">
          <input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)} />
          <span className="small">Note on {subject.kind === 'person' ? `${to}’s` : 'this'} context that I sent it (not in my journal)</span>
        </label>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary grow" onClick={copy}><Icon name="check" size={16} /> Copy</button>
          {channel === 'email' && <button className="btn grow" onClick={mail}><Icon name="send" size={16} /> Open in Mail</button>}
        </div>
        <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setOut(null)}><Icon name="back" size={14} /> Change what I asked for</button>
      </>}
    </Sheet>
  );
}
