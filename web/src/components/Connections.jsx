import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { useApp } from '../lib/context.js';

// Keys and passwords entered in Settings. They're stored encrypted on your server and never shown
// again; Settings only says whether one is set, where it came from, and its last four characters.

export function useConnections() {
  const [c, setC] = useState(null);
  const load = () => api.get('/connections').then(setC).catch(() => setC({}));
  useEffect(() => { load(); }, []);
  return [c, setC, load];
}

const SOURCE = { settings: 'Saved in Settings', env: 'From the server’s .env file', none: 'Not set' };

/** One key: status, replace, test, remove. */
export function KeyField({ name, info, label, help, link, test, onSaved, autoComplete = 'off' }) {
  const { notify } = useApp();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { ok, error }
  if (!info) return null;
  const set = info.set;
  async function save(v) {
    setBusy('save'); setResult(null);
    try {
      const next = await api.put('/connections', { [name]: v });
      onSaved?.(next); setValue(''); setEditing(false);
      if (v && test) await runTest(); else notify(v ? 'Saved' : 'Removed');
    } catch (e) { notify(e.message); }
    finally { setBusy(''); }
  }
  async function runTest() {
    setBusy('test');
    try { const r = await api.post('/connections/test', { what: test }); setResult(r); }
    catch (e) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(''); }
  }
  return (
    <div className="key-field">
      <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b className="grow" style={{ fontSize: 15 }}>{label || info.label}</b>
        <span className={`small ${set ? '' : 'muted'}`}>{info.unreadable ? 'Needs re-entering' : set ? `${SOURCE[info.source]}${info.hint ? ` · ${info.hint}` : ''}` : 'Not set'}</span>
      </div>
      {help && <p className="small muted" style={{ margin: '2px 0 6px' }}>{help}{link && <> <a href={link} target="_blank" rel="noopener noreferrer">Get one</a>.</>}</p>}
      {result && (result.ok
        ? <p className="small" style={{ margin: '4px 0', color: 'var(--accent)' }}><Icon name="check" size={14} /> Works.</p>
        : <p className="small" role="alert" style={{ margin: '4px 0', color: 'var(--rec-text)' }}>{result.error}</p>)}
      {editing || !set ? (
        <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); if (value.trim()) save(value.trim()); }}>
          <input className="input" type="password" autoComplete={autoComplete} spellCheck="false" autoCapitalize="none" value={value}
            onChange={e => setValue(e.target.value)} placeholder={set ? 'Paste a new one' : 'Paste it here'} aria-label={label || info.label} />
          <button className="btn small primary" disabled={!value.trim() || !!busy}>{busy === 'save' ? <span className="spinner" /> : 'Save'}</button>
          {set && <button type="button" className="btn small ghost" onClick={() => { setEditing(false); setValue(''); }}>Cancel</button>}
        </form>
      ) : (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {test && <button className="btn small" onClick={runTest} disabled={!!busy}>{busy === 'test' ? <><span className="spinner" /> Testing…</> : 'Test'}</button>}
          <button className="btn small ghost" onClick={() => setEditing(true)}>Replace</button>
          {info.source === 'settings' && <button className="btn small ghost" onClick={() => save('')} disabled={!!busy}>Remove</button>}
        </div>
      )}
    </div>
  );
}

/** The three AI providers' keys, at the top of AI & transcription. */
export function AIKeys({ onChanged }) {
  const [c, setC] = useConnections();
  if (!c) return null;
  const saved = next => { setC(next); onChanged?.(); };
  return (
    <div className="card key-list">
      <p className="small muted" style={{ marginTop: 0 }}>Heartwood needs at least one. Keys are stored encrypted on your server and only used to talk to that provider. You pay the provider directly for what you use.</p>
      <KeyField name="anthropic_api_key" info={c.anthropic_api_key} label="Claude (Anthropic)" test="anthropic" onSaved={saved}
        help="Best for reflection and coaching." link="https://console.anthropic.com/settings/keys" />
      <KeyField name="gemini_api_key" info={c.gemini_api_key} label="Gemini (Google)" test="gemini" onSaved={saved}
        help="Also does transcription." link="https://aistudio.google.com/apikey" />
      <KeyField name="openai_api_key" info={c.openai_api_key} label="OpenAI" test="openai" onSaved={saved}
        help="Also does transcription." link="https://platform.openai.com/api-keys" />
    </div>
  );
}
