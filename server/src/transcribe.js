import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, tmpDir } from './config.js';
import { getSettings } from './db.js';

const CHUNK_SECONDS = 600; // 10-minute chunks keep every provider well under its upload limit

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.slice(-400)}`))));
  });
}

export async function probeSeconds(file) {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const n = parseFloat(out);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Normalize to mono 16 kHz MP3 and split into chunks. Returns chunk paths. */
export async function prepareChunks(file, workId) {
  const dir = path.join(tmpDir, workId);
  await fs.mkdir(dir, { recursive: true });
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-reset_timestamps', '1',
    path.join(dir, 'chunk_%03d.mp3')]);
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.mp3')).sort();
  return { dir, chunks: files.map(f => path.join(dir, f)) };
}

/**
 * Transcribe an audio file with the provider chosen in Settings.
 * @param {string} file
 * @param {{ hint?: string, kind?: string, workId: string }} opts
 */
export async function transcribeFile(file, { hint = '', kind = 'memo', workId }) {
  const s = getSettings();
  const provider = s.transcribe_provider;
  check(provider);
  const { dir, chunks } = await prepareChunks(file, workId);
  try {
    const parts = [];
    let previous = '';
    for (const chunk of chunks) {
      const text = await transcribeChunk(provider, s, chunk, { hint, kind, previous });
      parts.push(text.trim());
      previous = text.slice(-400);
    }
    return parts.filter(Boolean).join('\n\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function check(provider) {
  if (provider === 'local' && !config.whisperUrl) throw new Error('Local Whisper is selected but WHISPER_URL is not set. Start the whisper service or pick another engine in Settings.');
  if (provider === 'openai' && !config.keys.openai) throw new Error('OpenAI transcription is selected but there’s no OpenAI API key. Add one in Settings → AI & transcription.');
  if (provider === 'gemini' && !config.keys.gemini) throw new Error('Gemini transcription is selected but there’s no Gemini API key. Add one in Settings → AI & transcription.');
}

async function fileBlob(p) {
  return new Blob([await fs.readFile(p)], { type: 'audio/mpeg' });
}

async function transcribeChunk(provider, s, chunk, { hint, kind, previous }) {
  const vocab = hint ? `Names and terms that may appear: ${hint}.` : '';

  if (provider === 'local') {
    const form = new FormData();
    form.append('audio_file', await fileBlob(chunk), 'audio.mp3');
    const qs = new URLSearchParams({ task: 'transcribe', output: 'json', encode: 'true' });
    const prompt = [vocab, previous].filter(Boolean).join(' ');
    if (prompt) qs.set('initial_prompt', prompt.slice(-800));
    const res = await fetch(`${config.whisperUrl}/asr?${qs}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60 * 60 * 1000) });
    if (!res.ok) throw new Error(`Local Whisper error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return j.text || '';
  }

  if (provider === 'openai') {
    const form = new FormData();
    form.append('file', await fileBlob(chunk), 'audio.mp3');
    form.append('model', s.transcribe_models.openai);
    form.append('response_format', 'json');
    const prompt = [vocab, previous].filter(Boolean).join(' ');
    if (prompt) form.append('prompt', prompt.slice(-800));
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${config.keys.openai}` }, body: form,
      signal: AbortSignal.timeout(15 * 60 * 1000)
    });
    if (!res.ok) throw new Error(`OpenAI transcription error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return j.text || '';
  }

  if (provider === 'gemini') {
    const b64 = (await fs.readFile(chunk)).toString('base64');
    const multi = kind !== 'memo';
    const instruction = [
      'Transcribe this audio verbatim in its original language.',
      multi
        ? 'There may be several speakers. Start a new paragraph each time the speaker changes and prefix it with a label like "Speaker 1:", "Speaker 2:". Use a real name only if the speaker is clearly identified in the audio.'
        : 'Use natural paragraphs.',
      'Remove filler sounds like "um" only when they add nothing. Do not summarize, add notes or headings. Output only the transcript.',
      vocab,
      previous ? `For continuity, the previous part ended with: "${previous}"` : ''
    ].filter(Boolean).join(' ');
    const body = {
      contents: [{ role: 'user', parts: [{ text: instruction }, { inlineData: { mimeType: 'audio/mp3', data: b64 } }] }],
      generationConfig: { maxOutputTokens: 32000 }
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.transcribe_models.gemini)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.keys.gemini },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60 * 1000)
    });
    if (!res.ok) throw new Error(`Gemini transcription error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  }

  throw new Error(`Unknown transcription provider ${provider}`);
}
