import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

const COOKIE = 'heartwood_session';
const failures = new Map(); // ip -> { count, lockedUntil }
const MIN_LENGTH = 12;

// The password you set in the app is stored as a salted scrypt hash in its own
// table (never returned by any API). Until you set one, APP_PASSWORD from .env is used.
db.exec(`CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyHash(pw, stored) {
  const [scheme, s, h] = String(stored).split('$');
  if (scheme !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const actual = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

const envDigest = config.appPassword ? crypto.scryptSync(config.appPassword, 'heartwood-login', 32) : null;

function storedHash() {
  return db.prepare(`SELECT value FROM secrets WHERE key = 'password_hash'`).get()?.value || null;
}

export function passwordConfigured() {
  return !!storedHash() || !!envDigest;
}

function checkPassword(pw) {
  const stored = storedHash();
  if (stored) return verifyHash(pw || '', stored);
  if (!envDigest) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(pw || ''), 'heartwood-login', 32), envDigest);
}

// Also a server-wide brake, in case wrong guesses come from many addresses at once.
const recent = []; // timestamps of failures in the last hour
function tooMany(req, res) {
  const t = Date.now();
  while (recent.length && recent[0] < t - 3600e3) recent.shift();
  if (recent.length >= 50) {
    res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    return true;
  }
  const f = failures.get(req.ip);
  if (f && f.lockedUntil > Date.now()) {
    res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    return true;
  }
  return false;
}

function recordFailure(req) {
  recent.push(Date.now());
  if (failures.size > 10000) failures.clear(); // bound memory
  const f = failures.get(req.ip) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= 5) { f.lockedUntil = Date.now() + 15 * 60 * 1000; f.count = 0; }
  failures.set(req.ip, f);
}

// Sessions are stored as SHA-256 hashes, so a copy of the database can't be used to sign in.
const tokenHash = t => 'h:' + crypto.createHash('sha256').update(String(t)).digest('base64url');
function startSession(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 864e5;
  db.prepare('INSERT INTO sessions(token, expires_at) VALUES (?, ?)').run(tokenHash(token), Date.now() + maxAge);
  res.cookie(COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', maxAge, path: '/' });
  return token;
}

export function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function login(req, res) {
  if (tooMany(req, res)) return;
  if (!passwordConfigured()) return res.status(500).json({ error: 'No password is set. Add APP_PASSWORD to .env and restart.' });
  if (!checkPassword(req.body?.password)) {
    recordFailure(req);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  failures.delete(req.ip);
  startSession(res);
  res.json({ ok: true });
}

/** Change the password. Signs out every other device; this one stays signed in. */
export function changePassword(req, res) {
  if (tooMany(req, res)) return;
  const { current, next } = req.body || {};
  if (!checkPassword(current)) {
    recordFailure(req);
    return res.status(401).json({ error: 'Your current password is wrong.' });
  }
  const pw = String(next || '');
  if (pw.length < MIN_LENGTH) return res.status(400).json({ error: `Use at least ${MIN_LENGTH} characters.` });
  if (pw === current) return res.status(400).json({ error: 'That’s the same as your current password.' });

  db.transaction(() => {
    db.prepare(`INSERT INTO secrets(key, value) VALUES ('password_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(hashPassword(pw));
    db.prepare('DELETE FROM sessions').run();
  })();
  failures.delete(req.ip);
  startSession(res);
  res.json({ ok: true });
}

export function logout(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token IN (?, ?)').run(tokenHash(t), t);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

export function isAuthed(req) {
  const t = req.cookies?.[COOKIE];
  if (!t) return false;
  const h = tokenHash(t);
  let row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(h);
  if (!row) {
    // Sessions from before hashing: upgrade in place on first use.
    row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(t);
    if (row) db.prepare('UPDATE sessions SET token = ? WHERE token = ?').run(h, t);
  }
  return !!row && row.expires_at > Date.now();
}

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not signed in.' });
}

// ---------- passkeys (Face ID / Touch ID / security keys) ----------
// The password keeps working as a fallback; passkeys are an extra way in.
const challenges = new Map(); // challenge -> expiry
function rememberChallenge(c) {
  const t = Date.now();
  for (const [k, exp] of challenges) if (exp < t) challenges.delete(k);
  challenges.set(c, t + 5 * 60 * 1000);
}
function takeChallenge(c) {
  const exp = challenges.get(c);
  challenges.delete(c);
  return !!exp && exp > Date.now();
}
function relyingParty(req) {
  // Pin to the configured address rather than trusting the request's Host header.
  const origin = process.env.PUBLIC_ORIGIN || (process.env.HEARTWOOD_DOMAIN ? `https://${process.env.HEARTWOOD_DOMAIN}` : `${req.protocol}://${req.get('host')}`);
  return { origin, rpID: new URL(origin).hostname };
}
const webauthn = () => import('@simplewebauthn/server');

export function passkeysAvailable(req, res) {
  res.json({ available: !!db.prepare('SELECT 1 FROM passkeys LIMIT 1').get() });
}

export function listPasskeys(req, res) {
  res.json(db.prepare('SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY created_at').all());
}

export function deletePasskey(req, res) {
  db.prepare('DELETE FROM passkeys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}

export async function passkeyRegisterOptions(req, res, next) {
  try {
    const { generateRegistrationOptions } = await webauthn();
    const { rpID } = relyingParty(req);
    const existing = db.prepare('SELECT id, transports FROM passkeys').all();
    const opts = await generateRegistrationOptions({
      rpName: 'Heartwood',
      rpID,
      userName: 'heartwood',
      userDisplayName: 'Heartwood',
      userID: new TextEncoder().encode('heartwood-owner'),
      attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: c.id, transports: JSON.parse(c.transports || '[]') })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
    });
    rememberChallenge(opts.challenge);
    res.json(opts);
  } catch (err) { next(err); }
}

export async function passkeyRegisterVerify(req, res, next) {
  try {
    const { verifyRegistrationResponse } = await webauthn();
    const { origin, rpID } = relyingParty(req);
    const response = req.body?.response;
    const v = await verifyRegistrationResponse({
      response, expectedChallenge: takeChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false
    });
    if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: 'Couldn’t verify the passkey.' });
    const { credential } = v.registrationInfo;
    const name = String(req.body?.name || '').trim().slice(0, 60) || guessDeviceName(req.get('user-agent'));
    db.prepare('INSERT OR REPLACE INTO passkeys(id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(credential.id, Buffer.from(credential.publicKey), credential.counter || 0,
        JSON.stringify(credential.transports || response?.response?.transports || []), name, new Date().toISOString());
    res.json({ ok: true });
  } catch (err) { console.error('[passkey]', err.message); res.status(400).json({ error: 'Couldn’t add the passkey. Try again.' }); }
}

export async function passkeyLoginOptions(req, res, next) {
  try {
    const { generateAuthenticationOptions } = await webauthn();
    const { rpID } = relyingParty(req);
    const opts = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
    rememberChallenge(opts.challenge);
    res.json(opts);
  } catch (err) { next(err); }
}

export async function passkeyLoginVerify(req, res) {
  if (tooMany(req, res)) return;
  try {
    const { verifyAuthenticationResponse } = await webauthn();
    const { origin, rpID } = relyingParty(req);
    const response = req.body?.response;
    const cred = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response?.id);
    if (!cred) { recordFailure(req); return res.status(401).json({ error: 'That passkey isn’t registered with Heartwood.' }); }
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: takeChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key), counter: cred.counter, transports: JSON.parse(cred.transports || '[]') }
    });
    if (!v.verified) { recordFailure(req); return res.status(401).json({ error: 'Passkey sign-in failed.' }); }
    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(v.authenticationInfo.newCounter, new Date().toISOString(), cred.id);
    failures.delete(req.ip);
    startSession(res);
    res.json({ ok: true });
  } catch (err) {
    recordFailure(req);
    console.error('[passkey]', err.message);
    res.status(401).json({ error: 'Passkey sign-in failed.' });
  }
}

function guessDeviceName(ua = '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}
