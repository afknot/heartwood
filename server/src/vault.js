// Keys and passwords you enter in Settings (AI providers, GitHub, the invite mailbox).
// Stored in the database encrypted with AES-256-GCM. The encryption key lives in data/.vault-key,
// which is not part of backups, so a copied database or backup doesn't expose them. After a restore
// onto a new server, re-enter them in Settings (Heartwood says which are missing).
// Values set in Settings win over .env; .env still works for anyone who prefers it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, setSecretSource } from './config.js';
import { db } from './db.js';

export const VAULT_FIELDS = {
  anthropic_api_key: { env: 'ANTHROPIC_API_KEY', label: 'Claude (Anthropic) API key' },
  openai_api_key: { env: 'OPENAI_API_KEY', label: 'OpenAI API key' },
  gemini_api_key: { env: 'GEMINI_API_KEY', label: 'Gemini API key' },
  github_token: { env: 'GITHUB_TOKEN', label: 'GitHub token' },
  invite_email: { env: 'INVITE_EMAIL', label: 'Invite mailbox address', plain: true },
  invite_password: { env: 'INVITE_PASSWORD', label: 'Invite mailbox password', noHint: true },
  invite_imap_host: { env: 'INVITE_IMAP_HOST', label: 'Mail server (IMAP)', plain: true },
  invite_imap_port: { env: 'INVITE_IMAP_PORT', label: 'IMAP port', plain: true },
  slack_token: { env: 'SLACK_USER_TOKEN', label: 'Slack user token' },
  slack_channel: { env: 'SLACK_KUDOS_CHANNEL', label: 'Slack channel for kudos', plain: true },
  teams_webhook_url: { env: 'TEAMS_WEBHOOK_URL', label: 'Teams channel webhook', noHint: true }
};

const keyFile = path.join(config.dataDir, '.vault-key');
let key = null;
function vaultKey() {
  if (key) return key;
  try { key = fs.readFileSync(keyFile); } catch { /* first run */ }
  if (!key || key.length !== 32) {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
  }
  return key;
}

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
function open(sealed) {
  const raw = Buffer.from(String(sealed).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', vaultKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const cache = new Map();
const row = name => db.prepare('SELECT value FROM secrets WHERE key = ?').get(`vault:${name}`)?.value;

/** The value saved in Settings ('' if none, or if it can't be decrypted on this server). */
export function vaultGet(name) {
  if (cache.has(name)) return cache.get(name);
  let v = '';
  const sealed = row(name);
  if (sealed) { try { v = open(sealed); } catch { v = ''; } }
  cache.set(name, v);
  return v;
}

export function vaultSet(name, value) {
  if (!VAULT_FIELDS[name]) throw new Error('Unknown setting');
  const v = String(value ?? '').trim();
  if (!v) db.prepare('DELETE FROM secrets WHERE key = ?').run(`vault:${name}`);
  else db.prepare('INSERT INTO secrets(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`vault:${name}`, seal(v));
  cache.delete(name);
}

/** Settings value, else .env. */
export const secret = name => vaultGet(name) || (process.env[VAULT_FIELDS[name]?.env] || '').trim();

/** What Settings may show: never the value itself for secrets, just where it comes from and its last 4. */
export function vaultStatus() {
  const out = {};
  for (const [name, f] of Object.entries(VAULT_FIELDS)) {
    const saved = vaultGet(name);
    const unreadable = !saved && !!row(name);
    const env = (process.env[f.env] || '').trim();
    const v = saved || env;
    out[name] = {
      label: f.label,
      source: saved ? 'settings' : env ? 'env' : 'none',
      set: !!v,
      unreadable,
      ...(f.plain ? { value: v } : { hint: v && !f.noHint ? `…${v.slice(-4)}` : '' })
    };
  }
  return out;
}

db.exec(`CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
setSecretSource(secret);
