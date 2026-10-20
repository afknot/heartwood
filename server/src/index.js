import { talk } from './routes/talk.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import './db.js';
import './vault.js';
import {
  login, logout, isAuthed, requireAuth, cleanupSessions, changePassword, passwordConfigured,
  passkeysAvailable, listPasskeys, deletePasskey, passkeyRegisterOptions, passkeyRegisterVerify, passkeyLoginOptions, passkeyLoginVerify
} from './auth.js';
import { entries } from './routes/entries.js';
import { imports, retrySynthesis } from './routes/imports.js';
import { files } from './routes/files.js';
import { today } from './routes/today.js';
import { startCalendarSync } from './calendar.js';
import { startInviteChecks } from './invites.js';
import { startNotifications } from './notify.js';
import { backfillFollowups } from './followups.js';
import { startSnapshots } from './snapshots.js';
import { people } from './routes/people.js';
import { ai } from './routes/ai.js';
import { settings } from './routes/settings.js';
import { career } from './routes/career.js';
import { resumeJobs } from './jobs.js';
import { AIError } from './llm.js';

if (!passwordConfigured()) console.warn('⚠️  No password set — add APP_PASSWORD to .env so you can sign in.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, linklocal, uniquelocal'); // behind Caddy / Docker network

// Security headers. Everything Heartwood loads comes from this server, so the policy can be strict.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "media-src 'self' blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP + (req.secure ? '; upgrade-insecure-requests' : ''));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// Defense in depth against cross-site requests (the session cookie is already SameSite=Lax):
// anything that changes data must come from this site's own pages.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' });
  } else if (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site'))) {
    return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// --- API ---
// Which version is running (written by deploy/auto-update.sh after each automatic update).
const deployed = () => { try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, 'deployed.json'), 'utf8')); } catch { return null; } };
app.get('/api/health', (req, res) => res.json({ ok: true, version: deployed() }));
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', (req, res) => res.json({ authed: isAuthed(req) }));
app.post('/api/auth/password', requireAuth, changePassword);
app.get('/api/auth/passkey/available', passkeysAvailable);
app.post('/api/auth/passkey/login/options', passkeyLoginOptions);
app.post('/api/auth/passkey/login/verify', passkeyLoginVerify);
app.get('/api/auth/passkeys', requireAuth, listPasskeys);
app.delete('/api/auth/passkeys/:id', requireAuth, deletePasskey);
app.post('/api/auth/passkey/register/options', requireAuth, passkeyRegisterOptions);
app.post('/api/auth/passkey/register/verify', requireAuth, passkeyRegisterVerify);

app.use('/api', requireAuth);
app.post('/api/entries/:id/synthesize', retrySynthesis);
app.use('/api/entries', entries);
app.use('/api/imports', imports);
app.use('/api', files);
app.use('/api', today);
app.use('/api/people', people);
app.use('/api', ai);
app.use('/api', settings);
app.use('/api', career);
app.use('/api', talk);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'One of those files is too large.' });
  if (err?.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'That’s too many files for one note (20 max).' });
  const status = err instanceof AIError ? 502 : err.status && err.status < 500 ? err.status : 500;
  console.error(err);
  // Don't echo internals (SQL, file paths, stack-ish messages) to the browser; friendly messages pass through.
  const internal = ['SqliteError', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(err?.name)
    || /^E[A-Z]+$/.test(err?.code || '') || /\/(app|data|usr|tmp)\//.test(err?.message || '');
  res.status(status).json({ error: internal ? 'Something went wrong. The details are in the server log.' : (err.message || 'Something went wrong.') });
});

// --- Web app ---
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, {
    index: false,
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

cleanupSessions();
setInterval(cleanupSessions, 6 * 3600 * 1000).unref();
resumeJobs();
backfillFollowups();
startCalendarSync();
startInviteChecks();
startNotifications();
startSnapshots();

const server = app.listen(config.port, () => console.log(`Heartwood listening on :${config.port}`));
// A long recording over a slow phone connection can take more than Node's default 5 minutes to upload;
// cutting it off left recordings stuck on the phone. Allow up to an hour per request.
server.requestTimeout = 60 * 60e3;
server.headersTimeout = 65e3;
server.keepAliveTimeout = 65e3;
