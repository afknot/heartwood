// One recording: the microphone (optionally mixed with a meeting tab's sound), saved to the device a
// few seconds at a time so nothing is lost if the app is closed, suspended or the mic drops out.
import { startDraft, addPart, heartbeat, finishDraft, discardDraft } from './pending.js';

const SAVE_EVERY_MS = 4000;
const SILENT_RMS = 0.0025;      // below this is a muted or disconnected mic, not a quiet room
const SILENCE_WARN_MS = 8000;

export function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/** Desktop browsers that can share a tab's sound (Chrome, Edge). Not phones. */
export const canShareTabAudio = () => !!navigator.mediaDevices?.getDisplayMedia
  && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

export async function listMics() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch { return []; }
}

export function micError(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Microphone access is blocked for Heartwood. Allow it in your browser’s site settings (the icon left of the address), then try again. On a Mac, also check System Settings → Privacy & Security → Microphone for your browser.';
    case 'NotFoundError': case 'OverconstrainedError':
      return 'Heartwood couldn’t find that microphone. Plug it in or pick another one below.';
    case 'NotReadableError': case 'AbortError':
      return 'The microphone is busy or unavailable. Another app (Zoom, Teams, a call) may be holding it, or it was just unplugged. Pick another microphone, or close the other app’s audio and try again.';
    default: return `Couldn’t start the microphone: ${e?.message || e}`;
  }
}

/** Open a microphone for a test or a recording. */
export function openMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
}

/** Loudness meter for a stream. Calls onLevel(rms) every frame; returns a stop function. */
export function meter(stream, onLevel) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
    onLevel(Math.sqrt(sum / buf.length));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
}

export class Recording {
  constructor({ id, meta, deviceId = '', tabAudio = false, onLevel = () => {}, onSilence = () => {}, onDrop = () => {}, onTabMissing = () => {} }) {
    Object.assign(this, { id, meta: { ...meta, created: Date.now() }, deviceId, tabAudio, onLevel, onSilence, onDrop, onTabMissing });
    this.batch = []; this.seq = 0; this.queue = Promise.resolve();
    this.maxRms = 0; this.quietSince = 0; this.warned = false; this.tracks = [];
  }

  async start() {
    const mic = await openMic(this.deviceId);
    this.tracks.push(...mic.getTracks());
    this.micTracks = mic.getAudioTracks();
    this.micLabel = this.micTracks[0]?.label || '';
    let source = mic;
    if (this.tabAudio) {
      // The meeting's sound from a browser tab, mixed with your mic, so you capture everyone even on headphones.
      let tab = null;
      try { tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include' }); }
      catch { this.onTabMissing('cancelled'); }
      if (tab) {
        tab.getVideoTracks().forEach(t => t.stop());
        if (!tab.getAudioTracks().length) this.onTabMissing('no-audio');
        else {
          this.tracks.push(...tab.getAudioTracks());
          const Ctx = window.AudioContext || window.webkitAudioContext;
          this.mixCtx = new Ctx();
          const dest = this.mixCtx.createMediaStreamDestination();
          this.mixCtx.createMediaStreamSource(mic).connect(dest);
          this.mixCtx.createMediaStreamSource(new window.MediaStream(tab.getAudioTracks())).connect(dest);
          source = dest.stream;
          this.hasTab = true;
        }
      }
    }
    for (const t of mic.getAudioTracks()) t.addEventListener('ended', () => this.onDrop('ended'));
    this.source = source; // shared with the live coach, which listens to the same sound

    const mime = pickMime();
    const r = new MediaRecorder(source, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    this.type = r.mimeType || mime;
    r.ondataavailable = e => { if (e.data?.size) this.batch.push(e.data); };
    this.stopped = new Promise(res => { r.onstop = res; });
    await startDraft(this.id, this.meta).catch(() => {});
    r.start(1000);
    this.rec = r;
    this.saver = setInterval(() => this.checkpoint(), SAVE_EVERY_MS);
    this.stopMeter = meter(source, rms => {
      if (rms > this.maxRms) this.maxRms = rms;
      if (this.rec?.state === 'recording') {
        if (rms < SILENT_RMS) {
          if (!this.quietSince) this.quietSince = performance.now();
          else if (!this.warned && performance.now() - this.quietSince > SILENCE_WARN_MS) { this.warned = true; this.onSilence(true); }
        } else {
          this.quietSince = 0;
          if (this.warned) { this.warned = false; this.onSilence(false); }
        }
      }
      // Gate out room noise, then scale up so normal speech moves the rings well.
      this.onLevel(Math.min(1, Math.max(0, (rms - 0.012) * 18)));
    });
  }

  get state() { return this.rec?.state || 'inactive'; }
  /** True when the browser stopped the recording behind our back (app suspended, mic lost). */
  get interrupted() {
    if (!this.rec) return false;
    if (this.rec.state === 'inactive' || this.micTracks.some(t => t.readyState === 'ended')) return true;
    // Phones (iOS especially) mute the mic while the app is in the background and may not bring it back.
    return navigator.maxTouchPoints > 0 && this.micTracks.some(t => t.muted);
  }

  setMeta(patch) { Object.assign(this.meta, patch); }

  /** Write what's in memory to the device (queued so writes stay in order). */
  checkpoint() {
    const parts = this.batch.splice(0);
    this.queue = this.queue.then(() => (parts.length
      ? addPart(this.id, this.seq++, new Blob(parts, { type: this.type || parts[0]?.type }), this.meta)
      : heartbeat(this.id, this.meta, this.seq))).catch(() => {});
    return this.queue;
  }

  pause() { if (this.rec?.state === 'recording') this.rec.pause(); }
  resume() { if (this.rec?.state === 'paused') this.rec.resume(); }

  release() {
    clearInterval(this.saver);
    this.stopMeter?.();
    this.tracks.forEach(t => t.stop());
    this.mixCtx?.close().catch(() => {});
  }

  /** Stop and return the finished recording (saved on the device, ready to upload), or null if empty. */
  async finish(meta = {}) {
    Object.assign(this.meta, meta);
    if (this.rec && this.rec.state !== 'inactive') {
      if (this.rec.state === 'paused') this.rec.resume();
      this.rec.stop();
      await Promise.race([this.stopped, new Promise(r => setTimeout(r, 2500))]);
    }
    this.release();
    await this.queue;
    const m = { ...this.meta }; delete m.created;
    return finishDraft(this.id, { meta: m, extra: this.batch.splice(0), type: this.type });
  }

  async discard() {
    if (this.rec && this.rec.state !== 'inactive') { this.rec.ondataavailable = null; this.rec.stop(); }
    this.release();
    await this.queue;
    await discardDraft(this.id).catch(() => {});
  }
}
