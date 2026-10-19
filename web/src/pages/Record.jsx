import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import GrainRings from '../components/GrainRings.jsx';
import { PeoplePicker } from '../components/Pickers.jsx';
import { uploadRecording } from '../api.js';
import { removePending } from '../lib/pending.js';
import { Recording, listMics, micError, openMic, meter, canShareTabAudio } from '../lib/recorder.js';
import { useApp } from '../lib/context.js';
import { duration } from '../lib/format.js';

const KIND_OPTS = [
  { k: 'memo', label: 'Voice memo', icon: 'mic' },
  { k: 'one_on_one', label: '1:1', icon: 'people' },
  { k: 'conversation', label: 'Conversation', icon: 'ask' },
  { k: 'meeting', label: 'Meeting', icon: 'journal' }
];
const uuid = () => crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
});
const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };

/** Pick a microphone and check it hears you, before recording. */
function MicCheck({ deviceId, setDeviceId, disabled }) {
  const [mics, setMics] = useState([]);
  const [testing, setTesting] = useState(false);
  const [lvl, setLvl] = useState(0);
  const [heard, setHeard] = useState(false);
  const [err, setErr] = useState('');
  const stopRef = useRef(null);
  const refresh = useCallback(() => listMics().then(setMics), []);
  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => { navigator.mediaDevices?.removeEventListener?.('devicechange', refresh); stopRef.current?.(); };
  }, [refresh]);
  useEffect(() => { if (disabled) { stopRef.current?.(); setTesting(false); } }, [disabled]);

  async function test(id = deviceId) {
    stopRef.current?.();
    setErr(''); setHeard(false); setLvl(0);
    try {
      const s = await openMic(id);
      const stopMeter = meter(s, rms => { setLvl(Math.min(1, rms * 9)); if (rms > 0.02) setHeard(true); });
      stopRef.current = () => { stopMeter(); s.getTracks().forEach(t => t.stop()); stopRef.current = null; };
      setTesting(true);
      refresh(); // labels appear once access is allowed
    } catch (e) { setErr(micError(e)); setTesting(false); }
  }
  const named = mics.some(m => m.label && !/^Microphone \d+$/.test(m.label));
  return (
    <div className="field mic-check">
      <span>Microphone</span>
      {mics.length > 1 || named ? (
        <select className="input" value={deviceId} onChange={e => { setDeviceId(e.target.value); if (testing) test(e.target.value); }} aria-label="Microphone">
          <option value="">Default ({mics.find(m => m.id === 'default')?.label?.replace(/^Default - /, '') || 'your browser’s choice'})</option>
          {mics.filter(m => m.id !== 'default').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      ) : null}
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn small" onClick={() => (testing ? (stopRef.current?.(), setTesting(false)) : test())}>
          <Icon name="mic" size={15} /> {testing ? 'Stop test' : 'Test microphone'}
        </button>
        {testing && <div className="mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lvl * 100)}><div style={{ width: `${Math.round(lvl * 100)}%` }} /></div>}
      </div>
      {testing && <small role="status">{heard ? '✓ Heard you. This microphone works.' : 'Say something. The bar should move. If it doesn’t, pick another microphone.'}</small>}
      {err && <div className="banner error" role="alert" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

export default function Record() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { people, notify } = useApp();
  const [stage, setStage] = useState('setup'); // setup | recording | paused | interrupted | saving
  const [kind, setKind] = useState(() => KIND_OPTS.some(o => o.k === params.get('kind')) ? params.get('kind') : 'memo');
  const [who, setWho] = useState(() => (params.get('person') || '').split(',').filter(Boolean));
  const [title, setTitle] = useState(() => (params.get('title') || '').slice(0, 120));
  const [consent, setConsent] = useState(false);
  const [picker, setPicker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [deviceId, setDeviceIdState] = useState(() => store.get('hw:mic'));
  const setDeviceId = id => { setDeviceIdState(id); store.set('hw:mic', id); };
  const [tabAudio, setTabAudio] = useState(false);
  const [silent, setSilent] = useState(false);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(null); // { seconds, entryId } after an interruption

  const recRef = useRef(null);
  const clock = useRef({ start: 0, acc: 0 });
  const wake = useRef(null);
  const level = useRef(0); // live mic loudness 0..1, read by the rings each frame
  const getLevel = useCallback(() => level.current, []);
  const part = useRef(1);

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  const secure = window.isSecureContext;
  const live = stage === 'recording' || stage === 'paused';
  const seconds = () => { const c = clock.current; return (c.acc + (stage === 'recording' ? performance.now() - c.start : 0)) / 1000; };

  // Reset consent whenever the situation changes, so it's always a fresh confirmation.
  useEffect(() => setConsent(false), [kind, who.length]);

  useEffect(() => {
    if (!live) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const t = setInterval(() => {
      const s = seconds();
      setElapsed(s);
      recRef.current?.setMeta({ seconds: s });
    }, 250);
    return () => { window.removeEventListener('beforeunload', warn); clearInterval(t); };
  }, [live, stage]);

  // Leaving the app (home button, another app, locking the phone): save what's recorded right away.
  // Coming back: if the phone stopped the recording, keep what was saved and offer to continue.
  useEffect(() => {
    if (!live) return;
    const hidden = () => {
      const r = recRef.current;
      if (!r) return;
      r.setMeta({ seconds: seconds() });
      r.checkpoint();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') return hidden();
      const r = recRef.current;
      if (r?.interrupted) finish({ interrupted: true });
      else if (r) {
        wake.current?.release?.().catch(() => {});
        navigator.wakeLock?.request('screen').then(w => { wake.current = w; }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hidden);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', hidden); };
  }, [live, stage]);

  useEffect(() => () => { recRef.current?.release(); wake.current?.release?.().catch(() => {}); }, []);

  async function start() {
    setError(''); setSilent(false); setNotice('');
    const id = uuid();
    const meta = {
      client_id: id, kind, people: who, title: part.current > 1 ? `${title.trim() || 'Recording'} (part ${part.current})` : title.trim(),
      seconds: 0, recorded_at: new Date().toISOString(), consent_confirmed: true
    };
    const r = new Recording({
      id, meta, deviceId, tabAudio: tabAudio && canShareTabAudio(),
      onLevel: v => { level.current = v; },
      onSilence: setSilent,
      onDrop: () => { if (document.visibilityState === 'visible') setNotice('The microphone disconnected. What you recorded so far is saved.'); },
      onTabMissing: why => setNotice(why === 'no-audio'
        ? 'No meeting sound was shared, so only your microphone is recording. Next time, pick the meeting’s tab and turn on “Share tab audio”.'
        : 'Recording your microphone only.')
    });
    try {
      await r.start();
    } catch (e) {
      r.release();
      await r.discard().catch(() => {});
      return setError(micError(e));
    }
    recRef.current = r;
    clock.current = { start: performance.now(), acc: 0 };
    try { wake.current = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
    setStage('recording');
  }

  function pause() {
    recRef.current.pause();
    clock.current.acc += performance.now() - clock.current.start;
    setStage('paused');
  }
  function resume() {
    recRef.current.resume();
    clock.current.start = performance.now();
    setStage('recording');
  }

  async function discard() {
    if (!confirm('Discard this recording? It will not be saved anywhere.')) return;
    await recRef.current?.discard();
    recRef.current = null;
    wake.current?.release?.().catch(() => {});
    nav('/journal');
  }

  /** Stop (or recover after an interruption), keep it on the device, then upload. */
  async function finish({ interrupted = false } = {}) {
    const r = recRef.current;
    if (!r || stage === 'saving') return;
    const secs = interrupted ? (r.meta.seconds || elapsed) : seconds();
    if (!interrupted && r.maxRms < 0.004 && secs > 5 && !confirm(`Heartwood didn’t hear anything in this recording${r.micLabel ? ` from “${r.micLabel}”` : ''}. Save it anyway?`)) return;
    recRef.current = null;
    wake.current?.release?.().catch(() => {});
    setStage('saving'); setProgress(0);
    const item = await r.finish({ seconds: secs, ...(interrupted ? { interrupted: true } : {}) }).catch(() => null);
    if (!item) {
      notify('Nothing was recorded.');
      return interrupted ? setStage('setup') : nav('/journal', { replace: true });
    }
    try {
      const entry = await uploadRecording(item.blob, item.meta, setProgress);
      await removePending(item.id).catch(() => {});
      if (interrupted) { setSaved({ seconds: secs, entryId: entry.id }); setStage('interrupted'); }
      else nav(`/entry/${entry.id}`, { replace: true });
    } catch (e) {
      if (interrupted) { setSaved({ seconds: secs, entryId: null }); setStage('interrupted'); }
      else { notify(e.status ? e.message : 'Saved on this device. It will upload when you’re back online.'); nav('/journal', { replace: true }); }
    }
  }

  const selectedPeople = people.filter(p => who.includes(p.id));
  const confirmText = kind === 'memo'
    ? 'This is just me speaking. No one else will be recorded.'
    : 'Everyone in this conversation knows it is being recorded and has agreed to it.';

  if (stage === 'saving') {
    return (
      <main className="page no-tabs"><div className="rec-stage">
        <span className="spinner" style={{ width: 32, height: 32 }} />
        <div><h2 style={{ fontFamily: 'var(--serif)', margin: 0 }}>Saving your recording</h2>
          <p className="muted">It’s safe on this device. Uploading to your server…</p></div>
        <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div></main>
    );
  }

  if (stage === 'interrupted') {
    return (
      <main className="page no-tabs"><div className="rec-stage">
        <span className="rec-ic-ok" aria-hidden="true"><Icon name="check" size={28} /></span>
        <div>
          <h2 style={{ fontFamily: 'var(--serif)', margin: 0 }}>Your recording was saved</h2>
          <p className="muted" style={{ maxWidth: 320 }}>The recording stopped when Heartwood left the screen, but the {duration(saved?.seconds || 0)} before that is safe{saved?.entryId ? '' : ' on this device and will upload when you’re back online'}.</p>
        </div>
        <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
          <button className="btn rec block" onClick={() => { part.current += 1; setConsent(true); start(); }}><Icon name="mic" /> Keep recording (part {part.current + 1})</button>
          {saved?.entryId && <button className="btn block" onClick={() => nav(`/entry/${saved.entryId}`, { replace: true })}>Open what was saved</button>}
          <button className="btn ghost block" onClick={() => nav('/journal', { replace: true })}>Done</button>
        </div>
        <p className="small muted" style={{ maxWidth: 320 }}>Continuing makes a second recording with the same people. Phones stop the microphone when you switch apps, so keep Heartwood on screen while recording.</p>
      </div></main>
    );
  }

  if (live) {
    return (
      <main className="page no-tabs"><div className="rec-stage">
        <span className={`rec-state${stage === 'paused' ? ' paused' : ''}`}>
          {stage === 'recording' ? <><span className="pulse" /> Recording</> : 'Paused'}
        </span>
        <div className="rec-time">{duration(elapsed)}</div>
        {silent && stage === 'recording' && (
          <div className="banner warn" role="alert" style={{ maxWidth: 340, textAlign: 'left' }}>
            Heartwood isn’t hearing anything{recRef.current?.micLabel ? ` from “${recRef.current.micLabel}”` : ''}. Check the microphone isn’t muted, or stop and pick another one.
          </div>
        )}
        {notice && <div className="banner" role="status" style={{ maxWidth: 340, textAlign: 'left' }}>{notice}</div>}
        <GrainRings getLevel={getLevel} paused={stage === 'paused'} />
        <div className="rec-controls">
          <button className="round" onClick={discard} aria-label="Discard"><Icon name="trash" /></button>
          <button className="round big" onClick={() => finish()} aria-label="Stop and save"><Icon name="stop" size={30} /></button>
          {stage === 'recording'
            ? <button className="round" onClick={pause} aria-label="Pause"><Icon name="pause" /></button>
            : <button className="round" onClick={resume} aria-label="Resume"><Icon name="play" /></button>}
        </div>
        <p className="small muted" style={{ maxWidth: 300 }}>Saved to this device every few seconds. Keep Heartwood on screen until you stop: phones stop the microphone when you switch apps.{recRef.current?.hasTab ? ' Recording your microphone and the meeting tab.' : ''}</p>
      </div></main>
    );
  }

  // ---- Setup & consent ----
  return (
    <main className="page no-tabs">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
        <h1 style={{ fontSize: 24 }}>New recording</h1>
      </div>

      {!secure && <div className="banner error" role="alert">The microphone only works over HTTPS. Open Heartwood from its https:// address.</div>}
      {secure && !supported && <div className="banner error" role="alert">This browser can’t record audio. Update iOS/Android or try another browser.</div>}

      <div className="field"><span>What are you recording?</span>
        <div className="kind-grid">
          {KIND_OPTS.map(o => (
            <button key={o.k} className={`kind-opt${kind === o.k ? ' on' : ''}`} onClick={() => setKind(o.k)}>
              <Icon name={o.icon} size={20} /> {o.label}
            </button>
          ))}
        </div>
      </div>

      {kind !== 'memo' && (
        <div className="field"><span>Who’s in it?</span>
          <div className="chips">
            {selectedPeople.map(p => <span key={p.id} className="chip accent">{p.name}</span>)}
            <button className="chip" onClick={() => setPicker(true)}><Icon name="plus" size={14} /> {who.length ? 'Edit' : 'Add people'}</button>
          </div>
        </div>
      )}

      <label className="field"><span>Title <small>(optional)</small></span>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Leave blank and Heartwood will name it" />
      </label>

      {secure && supported && <MicCheck deviceId={deviceId} setDeviceId={setDeviceId} disabled={stage !== 'setup'} />}

      {secure && supported && kind !== 'memo' && canShareTabAudio() && (
        <label className="check" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={tabAudio} onChange={e => setTabAudio(e.target.checked)} />
          <span>Also record the meeting’s sound from a browser tab
            <br /><small className="muted">For Google Meet, Teams or Zoom in the browser when you’re on headphones (otherwise your mic only hears you). You’ll pick the tab and turn on “Share tab audio”. Desktop apps’ sound can’t be shared this way.</small>
          </span>
        </label>
      )}

      <label className="check consent-card">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>{confirmText}
          {kind !== 'memo' && <><br /><small className="muted">Many places require consent from everyone before a private conversation is recorded.</small></>}
        </span>
      </label>

      {error && <div className="banner error mt" role="alert">{error}</div>}

      <button className="btn rec block mt-l" style={{ minHeight: 56, fontSize: 17 }} onClick={start} disabled={!consent || !supported || !secure}>
        <Icon name="mic" /> Start recording
      </button>

      <PeoplePicker open={picker} onClose={() => setPicker(false)} selected={who} onChange={setWho} />
    </main>
  );
}
