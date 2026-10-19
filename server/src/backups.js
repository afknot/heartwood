// Off-site encrypted backups, managed from Settings. The backup container (restic + rclone) does the
// work; Heartwood and it talk through small files in data/backup-status (see deploy/backup.sh).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { snapshotStatus } from './snapshots.js';

const dir = path.join(config.dataDir, 'backup-status');
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* read-only data dir */ }
const file = name => path.join(dir, name);
const readJson = name => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return null; } };
const touch = (name, content = new Date().toISOString(), mode = 0o644) => fs.writeFileSync(file(name), content, { mode });

export class BackupError extends Error {}

/** Passphrase and destination: chosen in Settings (config.json), or set in .env. */
function settingsConfig() { return readJson('config.json'); }
export function backupsEnabled() { return !!(process.env.RESTIC_PASSWORD || settingsConfig()?.password); }
function repository() { return settingsConfig()?.repository || process.env.RESTIC_REPOSITORY || '/backups'; }

export function where(repo) {
  const r = String(repo || '');
  let m;
  if ((m = r.match(/^rclone:gdrive:(.+)$/))) return { kind: 'gdrive', label: `Google Drive, folder “${m[1]}”`, folder: m[1] };
  if (r.startsWith('rclone:')) return { kind: 'rclone', label: `${r.split(':')[1]} (rclone), ${r.split(':').slice(2).join(':')}` };
  if (r.startsWith('b2:')) return { kind: 'b2', label: `Backblaze B2, bucket ${r.split(':')[1]}` };
  if (r.startsWith('s3:')) return { kind: 's3', label: 'S3-compatible storage' };
  if (!r || r === '/backups') return { kind: 'local', label: 'this server only (the backups folder)' };
  return { kind: 'other', label: r.split(':')[0] };
}

const DRIVE_ERR = /empty token|token|oauth|invalid_grant|unauthor|reconnect/i;

export function backupInfo() {
  const offsite = readJson('status.json');
  const drive = readJson('drive.json');
  // The sign-in link is only ever Google's; anything else is dropped rather than shown as a link.
  if (drive?.auth_url && !/^https:\/\/accounts\.google\.com\//.test(drive.auth_url)) drive.auth_url = '';
  const location = where(offsite?.repository || repository());
  // The service checks for requests every few seconds; a request still sitting there after a minute means it isn't running.
  const reqAge = (() => { try { return Date.now() - fs.statSync(file('request')).mtimeMs; } catch { return null; } })();
  return {
    ...snapshotStatus(),
    enabled: backupsEnabled(),
    managed_in_settings: !!settingsConfig()?.password,
    location, offsite,
    requested: reqAge !== null,
    service_down: reqAge !== null && reqAge > 90e3,
    drive: location.kind === 'gdrive' ? {
      ...(drive || {}),
      needs_connecting: !!(offsite && !offsite.ok && DRIVE_ERR.test(offsite.error || '') && drive?.stage !== 'connected')
    } : null,
    repository_kind: repository().split(':')[0] || null,
    // The backup service's own log, for "Details" when something goes wrong (no secrets are written to it).
    log_tail: (() => { try { return fs.readFileSync(file('backup.log'), 'utf8').trim().split('\n').slice(-12).join('\n'); } catch { return ''; } })()
  };
}

export function requestBackup() {
  if (!backupsEnabled()) throw new BackupError('Encrypted backups aren’t turned on yet.');
  touch('request');
}

/** Turn on backups from Settings: a passphrase you keep, and where to put them. */
export function setupBackups({ passphrase = '', destination = 'gdrive' } = {}) {
  if (backupsEnabled()) throw new BackupError('Backups are already turned on. To change the passphrase, see README → Backups.');
  const pass = String(passphrase);
  if (pass.length < 12) throw new BackupError('Use a passphrase of at least 12 characters. A few random words works well.');
  const repo = destination === 'local' ? '/backups' : 'rclone:gdrive:Heartwood-backups';
  touch('config.json', JSON.stringify({ password: pass, repository: repo, created_at: new Date().toISOString() }), 0o600);
  return backupInfo();
}

/** Connect Google Drive: ask the backup service for a sign-in link. */
export function startDrive() {
  touch('drive.json', JSON.stringify({ stage: 'starting', at: new Date().toISOString() }));
  touch('drive-start');
}

/** The address Google sent you back to (it won't load on your device; that's expected). */
export function finishDrive(pasted) {
  let u;
  try { u = new URL(String(pasted || '').trim()); } catch { throw new BackupError('Paste the whole address from your browser’s address bar.'); }
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  const err = u.searchParams.get('error');
  if (err) throw new BackupError(err === 'access_denied' ? 'Google access wasn’t allowed. Start again and choose Allow.' : `Google said: ${err}`);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !code || !state) throw new BackupError('That isn’t the address Google sent you back to. It starts with http://127.0.0.1:53682/');
  const clean = new URLSearchParams({ state, code, ...(u.searchParams.get('scope') ? { scope: u.searchParams.get('scope') } : {}) });
  touch('drive.json', JSON.stringify({ stage: 'finishing', at: new Date().toISOString() }));
  touch('drive-callback', `http://127.0.0.1:53682/?${clean}`, 0o600);
}

/** Failing or stale off-site backups, for the morning heads-up (null when fine or turned off). */
export function backupProblem() {
  if (!backupsEnabled()) return null;
  const st = readJson('status.json');
  if (!st) return null;
  const last = Date.parse(st.last_success || '') || 0;
  if (st.ok && Date.now() - last < 2 * 864e5) return null;
  return DRIVE_ERR.test(st.error || '') ? 'Backups: connect Google Drive in Settings to turn on off-site backups.' : 'Backups haven’t gone through lately. See Settings.';
}
