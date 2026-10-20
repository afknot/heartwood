// Recordings are saved on the device (IndexedDB) while they're being made, a few seconds at a time,
// so a dropped connection, a closed app or the phone suspending Heartwood never loses what was said.
//
//   pending  finished recordings waiting to upload: { id, blob, meta, created }
//            and recordings in progress: { id, draft: true, meta, heartbeat, parts }
//   parts    the audio of a recording in progress, in order: { rec, seq, blob }
//
// If a recording in progress stops getting heartbeats (the app was closed or suspended), the next
// time Heartwood opens it puts the parts back together and uploads what was recorded.
import { uploadRecording } from '../api.js';

const DB = 'heartwood', STORE = 'pending', PARTS = 'parts';
const STALE_MS = 45e3; // no heartbeat for this long = the recording was interrupted

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PARTS)) db.createObjectStore(PARTS, { keyPath: ['rec', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(...(Array.isArray(stores) ? stores.map(s => t.objectStore(s)) : [t.objectStore(stores)]));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const savePending = item => tx(STORE, 'readwrite', s => s.put(item));
export const removePending = id => tx(STORE, 'readwrite', s => s.delete(id));
export const listPending = () => tx(STORE, 'readonly', s => s.getAll());

// ---------- recordings in progress ----------
/** Start saving a recording as it's made. */
export const startDraft = (id, meta) => savePending({ id, draft: true, meta, heartbeat: Date.now(), parts: 0, created: Date.now() });

/** Save the next few seconds of audio, and note that the recording is still going. */
export function addPart(id, seq, blob, meta) {
  return tx([STORE, PARTS], 'readwrite', (s, p) => {
    p.put({ rec: id, seq, blob });
    s.put({ id, draft: true, meta, heartbeat: Date.now(), parts: seq + 1, created: meta.created || Date.now() });
  });
}

/** Just the heartbeat (while paused, nothing new to save). */
export const heartbeat = (id, meta, parts) => savePending({ id, draft: true, meta, heartbeat: Date.now(), parts, created: meta.created || Date.now() });

async function partsOf(id) {
  return tx(PARTS, 'readonly', p => p.getAll(window.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
}

/**
 * Turn a recording in progress into a finished one waiting to upload (from the saved parts, plus any
 * still in memory). Returns the finished item, or null if nothing was recorded.
 */
export async function finishDraft(id, { meta, extra = [], type = '' } = {}) {
  const item = (await listPending()).find(x => x.id === id);
  if (item && !item.draft && item.blob) return item; // already finished (e.g. recovered when the app reopened)
  const saved = (await partsOf(id)).sort((a, b) => a.seq - b.seq);
  const blobs = [...saved.map(x => x.blob), ...extra];
  const m = { ...(item?.meta || {}), ...(meta || {}) };
  delete m.created;
  if (!blobs.length || !blobs.some(b => b.size)) {
    await discardDraft(id);
    return null;
  }
  const blob = new Blob(blobs, { type: type || blobs[0]?.type || 'audio/webm' });
  const done = { id, blob, meta: m, created: item?.created || Date.now() };
  await tx([STORE, PARTS], 'readwrite', (s, p) => {
    s.put(done);
    p.delete(window.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
  return done;
}

export async function discardDraft(id) {
  await tx([STORE, PARTS], 'readwrite', (s, p) => {
    s.delete(id);
    p.delete(window.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
}

/** Recordings that were cut off (app closed or suspended) and haven't been recovered yet. */
export async function recoverInterrupted() {
  const out = [];
  for (const item of await listPending()) {
    if (!item.draft || Date.now() - (item.heartbeat || 0) < STALE_MS) continue;
    const done = await finishDraft(item.id, { meta: { ...item.meta, interrupted: true } }).catch(() => null);
    if (done) out.push(done);
  }
  return out;
}

// ---------- uploading, with progress anyone can watch ----------
// The upload state of each saved recording, broadcast as a "heartwood:uploads" window event so the
// Journal (and anything else) can show progress: { [id]: { state, progress, error, at } }
//   state: uploading | waiting (offline or the connection dropped; tries again on its own) | failed
//   (the server turned it down) ; uploaded items drop out.
const status = {};
const emit = () => window.dispatchEvent(new window.CustomEvent('heartwood:uploads', { detail: { ...status } }));
export const uploadStatus = () => ({ ...status });
const set = (id, patch) => { status[id] = { ...(status[id] || {}), ...patch, at: Date.now() }; emit(); };
const done = id => { delete status[id]; emit(); };

let flushing = false;
/** Try to upload anything left over (recovering interrupted recordings first). Returns how many succeeded. */
export async function flushPending() {
  if (flushing) return 0;
  flushing = true;
  let ok = 0;
  try {
    await recoverInterrupted().catch(() => []);
    const items = (await listPending()).filter(i => !i.draft && i.blob);
    if (!navigator.onLine) { for (const i of items) if (!i.error) set(i.id, { state: 'waiting', progress: 0 }); return 0; }
    for (const item of items) {
      if (item.error) { set(item.id, { state: 'failed', error: item.error }); continue; }
      set(item.id, { state: 'uploading', progress: 0 });
      try {
        await uploadRecording(item.blob, item.meta, p => set(item.id, { state: 'uploading', progress: p }));
        await removePending(item.id);
        done(item.id);
        ok++;
      } catch (err) {
        if (err.status && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) {
          // The server rejected it for good (e.g. a damaged file). Keep it on the phone, marked.
          await savePending({ ...item, error: err.message });
          set(item.id, { state: 'failed', error: err.message });
        } else {
          set(item.id, { state: 'waiting', progress: 0 });
        }
      }
    }
  } finally { flushing = false; }
  return ok;
}

/** Keep trying in the background: when the app comes back, when the connection returns, and every minute. */
let started = false;
export function startUploader(onUploaded) {
  if (started) return;
  started = true;
  const run = () => flushPending().then(n => { if (n) onUploaded?.(n); }).catch(() => {});
  run();
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    if ((await listPending().catch(() => [])).some(i => !i.draft && i.blob && !i.error)) run();
  }, 60e3);
}
