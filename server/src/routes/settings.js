import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, getSettings, saveSettings, hydrateEntry } from '../db.js';
import { availableProviders } from '../config.js';
import { vaultStatus, vaultSet, VAULT_FIELDS } from '../vault.js';
import { checkInbox } from '../invites.js';
import { backupInfo, requestBackup, setupBackups, startDrive, finishDrive, BackupError } from '../backups.js';
import { kindLabel, plainMentions } from '../prompts.js';

export const settings = express.Router();

// ---------- keys and connections, entered in Settings (stored encrypted; values never sent back) ----------
settings.get('/connections', (req, res) => res.json(vaultStatus()));
settings.put('/connections', (req, res) => {
  const b = req.body || {};
  for (const [name, value] of Object.entries(b)) {
    if (!VAULT_FIELDS[name] || typeof value !== 'string' || value.length > 4000) continue;
    if (name === 'invite_imap_port' && value && !/^\d{2,5}$/.test(value.trim())) return res.status(400).json({ error: 'The IMAP port is a number, usually 993.' });
    if (name === 'invite_email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return res.status(400).json({ error: 'That mailbox address doesn’t look right.' });
    if (name === 'invite_imap_host' && value && !/^[a-z0-9.-]+$/i.test(value.trim())) return res.status(400).json({ error: 'Enter just the mail server name, like mail.example.com.' });
    vaultSet(name, value);
  }
  if (Object.keys(b).some(k => k.startsWith('invite_'))) checkInbox().catch(() => {});
  res.json(vaultStatus());
});
// Check a key works, without spending anything: list models (or read the repo, for GitHub).
settings.post('/connections/test', async (req, res) => {
  const what = String(req.body?.what || '');
  const call = async (url, headers) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: r.status === 401 || r.status === 403 ? 'That key was turned down. Check you copied all of it, and that it’s active.' : (j.error?.message || j.message || `Error ${r.status}`).slice(0, 200) };
  };
  try {
    if (what === 'anthropic' && config.keys.anthropic) return res.json(await call('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': config.keys.anthropic, 'anthropic-version': '2023-06-01' }));
    if (what === 'openai' && config.keys.openai) return res.json(await call('https://api.openai.com/v1/models', { authorization: `Bearer ${config.keys.openai}` }));
    if (what === 'gemini' && config.keys.gemini) return res.json(await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': config.keys.gemini }));
    if (what === 'github' && config.githubToken) {
      const repo = getSettings().career?.repo;
      return res.json(await call(repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://api.github.com/repos/${repo}` : 'https://api.github.com/user',
        { authorization: `Bearer ${config.githubToken}`, accept: 'application/vnd.github+json', 'user-agent': 'Heartwood' }));
    }
    res.json({ ok: false, error: 'Nothing saved to test yet.' });
  } catch (e) {
    res.json({ ok: false, error: /timeout|abort/i.test(e.message) ? 'No answer from the provider. Try again.' : 'Couldn’t reach the provider from your server.' });
  }
});

settings.get('/backups', (req, res) => res.json(backupInfo()));
const backupRoute = fn => (req, res) => {
  try { res.status(202).json(fn(req.body || {}) || backupInfo()); }
  catch (e) { res.status(e instanceof BackupError ? 400 : 500).json({ error: e instanceof BackupError ? e.message : 'Something went wrong.' }); }
};
settings.post('/backups/run', backupRoute(() => { requestBackup(); }));
settings.post('/backups/setup', backupRoute(b => setupBackups({ passphrase: b.passphrase, destination: b.destination })));
settings.post('/backups/drive/start', backupRoute(() => { startDrive(); }));
settings.post('/backups/drive/finish', backupRoute(b => { finishDrive(b.url); }));
settings.get('/settings', (req, res) => res.json({ settings: getSettings(), available: availableProviders(), backups: backupInfo() }));

settings.put('/settings', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (['anthropic', 'openai', 'gemini'].includes(b.ai_provider)) patch.ai_provider = b.ai_provider;
  if (['local', 'openai', 'gemini'].includes(b.transcribe_provider)) patch.transcribe_provider = b.transcribe_provider;
  for (const k of ['auto_analyze', 'auto_organize', 'delete_audio_after_transcribe']) if (typeof b[k] === 'boolean') patch[k] = b[k];
  const str = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.trim().slice(0, 2000)]));
  if (b.models) patch.models = { ...getSettings().models, ...str(b.models) };
  if (b.transcribe_models) patch.transcribe_models = { ...getSettings().transcribe_models, ...str(b.transcribe_models) };
  if (b.profile) patch.profile = { ...getSettings().profile, ...str(b.profile) };
  if (b.career) {
    const c = str(b.career);
    if (c.repo && !/^[\w.-]+\/[\w.-]+$/.test(c.repo)) return res.status(400).json({ error: 'Use the form owner/repository, like you/your-portfolio.' });
    for (const k of ['story_dir', 'record_path', 'branch']) if (c[k] && /(^\/|\.\.)/.test(c[k])) return res.status(400).json({ error: 'Paths must stay inside the repository.' });
    patch.career = { ...getSettings().career, ...c };
  }
  res.json({ settings: saveSettings(patch), available: availableProviders() });
});

// ---------- updates from GitHub (Settings → Updates) ----------
// The server's updater (deploy/auto-update.sh, run by cron on the host) and the app talk only
// through small files in data/. The app can ask for an update; it can't run anything itself.
const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, f), 'utf8')); } catch { return null; } };
const writeJson = (f, v) => fs.writeFileSync(path.join(config.dataDir, f), JSON.stringify(v));
settings.get('/updates', (req, res) => {
  const status = readJson('update-status.json');
  const request = readJson('update-request.json');
  const prefs = readJson('update-settings.json') || { auto: true };
  res.json({
    set_up: !!status,
    auto: prefs.auto !== false,
    running: readJson('deployed.json'),
    status,
    requested_at: request?.at || null
  });
});
settings.post('/updates/now', (req, res) => {
  writeJson('update-request.json', { at: new Date().toISOString() });
  res.json({ ok: true });
});
settings.put('/updates/settings', (req, res) => {
  writeJson('update-settings.json', { auto: req.body?.auto !== false });
  res.json({ ok: true, auto: req.body?.auto !== false });
});

// Full export, so your journal is never locked in.
settings.get('/export.json', (req, res) => {
  const entries = db.prepare('SELECT * FROM entries ORDER BY created_at').all().map(r => hydrateEntry(r));
  const data = {
    exported_at: new Date().toISOString(),
    entries,
    people: db.prepare('SELECT * FROM people').all(),
    reports: db.prepare('SELECT * FROM reports').all(),
    followups: db.prepare('SELECT * FROM followups').all(),
    chats: db.prepare('SELECT * FROM chats').all().map(c => ({ ...c, messages: JSON.parse(c.messages || '[]') }))
  };
  res.setHeader('content-disposition', `attachment; filename="heartwood-export-${data.exported_at.slice(0, 10)}.json"`);
  res.json(data);
});

settings.get('/export.md', (req, res) => {
  const entries = db.prepare('SELECT * FROM entries ORDER BY created_at').all().map(r => hydrateEntry(r));
  const md = entries.map(e => [
    `# ${e.title || 'Untitled'}`,
    `*${e.created_at.slice(0, 16).replace('T', ' ')} · ${kindLabel(e.kind)}${e.people.length ? ' · ' + e.people.map(p => p.name).join(', ') : ''}${e.tags.length ? ' · #' + e.tags.join(' #') : ''}*`,
    plainMentions(e.body_md),
    e.transcript ? `## Transcript\n\n${e.transcript}` : '',
    e.source_text ? `## Original (${e.source_name || 'imported'})\n\n${e.source_text}` : '',
    e.analysis?.summary ? `## Summary\n\n${e.analysis.summary}` : ''
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n');
  res.setHeader('content-disposition', `attachment; filename="heartwood-export-${new Date().toISOString().slice(0, 10)}.md"`);
  res.type('text/markdown').send(md);
});
