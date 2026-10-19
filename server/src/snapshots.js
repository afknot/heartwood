// Nightly, consistent copy of the database at data/snapshots/heartwood.db.
// The optional encrypted backup service (restic, see README) backs up that copy
// plus your audio, files and photos, so a backup is never taken mid-write.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

const dir = path.join(config.dataDir, 'snapshots');
const target = path.join(dir, 'heartwood.db');
const state = { last: null, error: null };

export function snapshotStatus() {
  try { state.last = fs.statSync(target).mtime.toISOString(); } catch { /* none yet */ }
  return { ...state };
}

export async function takeSnapshot() {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp`;
  try {
    await db.backup(tmp);
    fs.renameSync(tmp, target);
    state.last = new Date().toISOString(); state.error = null;
  } catch (err) {
    state.error = err.message; console.error('[snapshot]', err.message);
    fs.rmSync(tmp, { force: true });
  }
}

export function startSnapshots() {
  const hour = Number(process.env.SNAPSHOT_HOUR ?? 3); // server local time (TZ in .env)
  let lastDay = null;
  const tick = () => {
    const d = new Date();
    const day = d.toDateString();
    if (d.getHours() === hour && lastDay !== day) { lastDay = day; takeSnapshot(); }
  };
  if (!fs.existsSync(target)) takeSnapshot();
  setInterval(tick, 5 * 60 * 1000).unref();
}
