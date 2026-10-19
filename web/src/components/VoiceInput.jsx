import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import GrainRings from './GrainRings.jsx';
import { openMic, meter, pickMime, micError } from '../lib/recorder.js';
import { useApp } from '../lib/context.js';
import { duration } from '../lib/format.js';

const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } } };

/**
 * Speak instead of typing, anywhere: records with the microphone you picked on the Record screen,
 * shows the same rings and timer, then transcribes and hands back the text.
 */
export function useDictation({ onText, maxSeconds = 300 } = {}) {
  const { notify } = useApp();
  const [state, setState] = useState('idle'); // idle | recording | transcribing
  const [secs, setSecs] = useState(0);
  const level = useRef(0);
  const getLevel = useCallback(() => level.current, []);
  const r = useRef({});
  const cleanup = () => {
    const x = r.current;
    clearInterval(x.timer); x.stopMeter?.(); x.stream?.getTracks().forEach(t => t.stop());
    r.current = {};
  };
  useEffect(() => () => { r.current.cancelled = true; if (r.current.rec?.state === 'recording') r.current.rec.stop(); cleanup(); }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify('Voice input isn’t supported in this browser.');
    try {
      const stream = await openMic(store.get('hw:mic'));
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        const cancelled = r.current.cancelled;
        cleanup();
        if (cancelled) return setState('idle');
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1500) return setState('idle');
        setState('transcribing');
        try {
          const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
          const form = new FormData();
          form.append('audio', blob, `dictation.${ext}`);
          const res = await fetch('/api/ask/dictate', { method: 'POST', body: form, credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Couldn’t transcribe that.');
          if (data.text) onText?.(data.text);
        } catch (e) { notify(e.message); }
        finally { setState('idle'); }
      };
      const stopMeter = meter(stream, rms => { level.current = Math.min(1, Math.max(0, (rms - 0.012) * 18)); });
      const started = Date.now();
      const timer = setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        setSecs(s);
        if (s >= maxSeconds && rec.state === 'recording') rec.stop();
      }, 250);
      r.current = { rec, stream, stopMeter, timer };
      rec.start();
      setSecs(0);
      setState('recording');
    } catch (e) { notify(micError(e)); }
  }
  const stop = () => r.current.rec?.state === 'recording' && r.current.rec.stop();
  const cancel = () => { r.current.cancelled = true; stop(); };
  return { state, secs, getLevel, start, stop, cancel };
}

/** The listening panel: small rings, timer, stop and cancel. Same look as the Record screen. */
export function DictationPanel({ d, label = 'Listening' }) {
  if (d.state === 'transcribing') {
    return <div className="dictation" role="status"><span className="spinner" /> <span className="grow">Writing down what you said…</span></div>;
  }
  if (d.state !== 'recording') return null;
  return (
    <div className="dictation" role="status" aria-live="polite">
      <GrainRings getLevel={d.getLevel} size={56} />
      <div className="grow" style={{ minWidth: 0 }}>
        <span className="rec-state" style={{ fontSize: 13 }}><span className="pulse" /> {label}</span>
        <div className="dictation-time">{duration(d.secs)}</div>
      </div>
      <button type="button" className="btn small ghost" onClick={d.cancel}>Cancel</button>
      <button type="button" className="round dictation-stop" onClick={d.stop} aria-label="Stop and write it down"><Icon name="stop" size={20} /></button>
    </div>
  );
}

/** A mic button for any text box; its panel shows where you put <DictationPanel>. */
export function MicButton({ d, disabled, label = 'Speak instead of typing' }) {
  return (
    <button type="button" className="icon-btn ghost-btn" onClick={d.state === 'recording' ? d.stop : d.start}
      disabled={disabled || d.state === 'transcribing'} aria-label={d.state === 'recording' ? 'Stop and write it down' : label} title={label}>
      {d.state === 'transcribing' ? <span className="spinner" /> : <Icon name={d.state === 'recording' ? 'stop' : 'mic'} />}
    </button>
  );
}

/** A text area with voice input built in. */
export function VoiceTextarea({ value, onChange, placeholder, rows = 4, label, autoFocus, id }) {
  const d = useDictation({ onText: t => onChange(value.trim() ? `${value.trimEnd()} ${t}` : t) });
  return (
    <div className="voice-ta">
      {d.state !== 'idle' ? <DictationPanel d={d} /> : (
        <textarea id={id} className="textarea" rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} />
      )}
      <div className="voice-ta-bar">
        <MicButton d={d} />
      </div>
    </div>
  );
}
