// Live coach: listens alongside a recording and asks the server for suggestions now and then.
// A second, short recorder on the same sound makes a self-contained clip every 30 seconds (the main
// recording keeps going untouched); each clip is transcribed on your server's chosen engine.
import { api } from '../api.js';
import { pickMime } from './recorder.js';

const CLIP_MS = 30000;
// Suggestions cost AI tokens, so they come every few minutes and only when enough new has been said.
const FIRST_SUGGEST_MS = 90000;
const SUGGEST_EVERY_MS = 180000;
const MIN_NEW_CHARS = 400;

export class LiveCoach {
  constructor({ stream, kind, people, title, seconds, onChange }) {
    Object.assign(this, { stream, kind, people, title, seconds, onChange });
    this.state = { status: 'starting', items: [], error: '', thinking: false, heard: false, at: 0 };
    this.paused = false;
    this.lastSuggest = 0;
    this.newSince = 0; // characters transcribed since the last suggestions
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.onChange?.(this.state); }

  async start() {
    try {
      const r = await api.post('/live', { kind: this.kind, people: this.people, title: this.title });
      this.id = r.id;
    } catch (e) { return this.set({ status: 'off', error: e.message }); }
    this.set({ status: 'listening' });
    this.startedAt = Date.now();
    this.clip();
    this.timer = setInterval(() => this.maybeSuggest(), 5000);
  }

  /** Record one clip, then send it and start the next. */
  clip() {
    if (this.stopped || this.paused) return;
    const mime = pickMime();
    let rec;
    try { rec = new window.MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined); }
    catch { return this.set({ status: 'off', error: 'This browser can’t listen for live suggestions while recording. Your recording is fine.' }); }
    const parts = [];
    const at = Math.round(this.seconds());
    rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      if (parts.length && this.id) this.send(new Blob(parts, { type }), type, at);
      this.clip();
    };
    try { rec.start(); } catch { return this.set({ status: 'off', error: 'Live suggestions couldn’t start. Your recording is fine.' }); }
    this.rec = rec;
    this.clipTimer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, CLIP_MS);
  }

  async send(blob, type, at) {
    const form = new FormData();
    form.append('at', String(at));
    form.append('audio', blob, `clip.${/mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm'}`);
    try {
      const res = await fetch(`/api/live/${this.id}/audio`, { method: 'POST', body: form, credentials: 'same-origin' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
      if (!j.skipped) { this.newSince += Math.max(0, (j.chars || 0) - (this.chars || 0)); this.chars = j.chars || 0; }
      if (this.chars > 0 && !this.state.heard) this.set({ heard: true });
      if (this.state.error) this.set({ error: '' });
    } catch (e) {
      this.set({ error: `Couldn’t transcribe the last bit (${String(e.message).slice(0, 140)}). Still trying.` });
    }
  }

  maybeSuggest() {
    if (this.paused || this.stopped || this.state.thinking) return;
    const since = Date.now() - (this.lastSuggest || this.startedAt);
    const due = this.lastSuggest ? since >= SUGGEST_EVERY_MS : since >= FIRST_SUGGEST_MS;
    if (due && this.newSince >= MIN_NEW_CHARS) this.suggest();
  }

  async suggest() {
    if (!this.id || this.state.thinking) return;
    this.set({ thinking: true });
    this.lastSuggest = Date.now();
    try {
      const r = await api.post(`/live/${this.id}/suggest`);
      this.newSince = 0;
      if (r.waiting) this.set({ thinking: false, error: '' });
      else this.set({ thinking: false, error: '', at: r.at, items: r.items?.length ? r.items : this.state.items, quiet: !r.items?.length });
    } catch (e) {
      this.set({ thinking: false, error: e.message });
    }
  }

  pause() { this.paused = true; clearTimeout(this.clipTimer); if (this.rec?.state === 'recording') this.rec.stop(); }
  resume() { if (!this.paused) return; this.paused = false; this.clip(); }

  stop() {
    this.stopped = true;
    clearInterval(this.timer); clearTimeout(this.clipTimer);
    try { if (this.rec?.state !== 'inactive') { this.rec.onstop = null; this.rec.stop(); } } catch { /* already stopped */ }
    if (this.id) api.del(`/live/${this.id}`).catch(() => {});
  }
}
