import fs from 'node:fs/promises';
import path from 'node:path';
import { audioDir, filesDir } from './config.js';
import { db, getEntryRow, hydrateEntry, updateEntry, getSettings, listPeople, setEntryPeople, now } from './db.js';
import { complete } from './llm.js';
import { transcribeFile, probeSeconds } from './transcribe.js';
import { entryAnalysisPrompt, importSynthesisPrompt, imageReadPrompt, filesSynthesisPrompt, parseMetaNote } from './prompts.js';
import { extractFile } from './files.js';
import { splitByDates } from './documents.js';
import { createPersonBrief } from './briefs.js';
import { syncFollowups } from './followups.js';

// A tiny serial queue: one heavy job at a time keeps a home server responsive.
let chain = Promise.resolve();
const queued = new Set();
export function enqueue(key, fn) {
  if (queued.has(key)) return;
  queued.add(key);
  chain = chain.then(fn).catch(err => console.error(`[job ${key}]`, err)).finally(() => queued.delete(key));
}

export function relatedEntries(entry, limit = 6) {
  const ids = (entry.people || []).map(p => p.id);
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT DISTINCT e.* FROM entries e JOIN entry_people ep ON ep.entry_id = e.id
    WHERE ep.person_id IN (${ids.map(() => '?').join(',')}) AND e.id != ? AND e.created_at < ?
    ORDER BY e.created_at DESC LIMIT ?`).all(...ids, entry.id, entry.created_at, limit);
  return rows.map(r => hydrateEntry(r)).reverse();
}

export async function analyzeEntry(id) {
  const row = getEntryRow(id);
  if (!row) return;
  const entry = hydrateEntry(row);
  if (!entry.body_md.trim() && !entry.transcript.trim()) throw new Error('Nothing to analyze yet.');
  const settings = getSettings();
  const people = listPeople();
  const prev = row.status;
  updateEntry(id, { status: 'analyzing', error: null });
  try {
    const { system, messages } = entryAnalysisPrompt({ entry, profile: settings.profile, people, related: relatedEntries(entry) });
    const a = await complete({ system, messages, json: true, maxTokens: 9000, task: 'reflection' });
    const analysis = normalizeAnalysis(a);
    updateEntry(id, { analysis, analysis_at: now(), status: 'ready' });
    syncFollowups(id, analysis.action_items);
    if (settings.auto_organize) applyOrganization(id, analysis, people);
    return hydrateEntry(getEntryRow(id));
  } catch (err) {
    updateEntry(id, { status: prev === 'analyzing' ? 'ready' : prev, error: `Analysis failed: ${err.message}` });
    throw err;
  }
}

function arr(v) { return Array.isArray(v) ? v : []; }
function normalizeAnalysis(a = {}) {
  return {
    title: String(a.title || '').slice(0, 120),
    summary: String(a.summary || ''),
    themes: arr(a.themes).map(String).slice(0, 8),
    tags: arr(a.tags).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8),
    people: arr(a.people).map(String),
    action_items: arr(a.action_items).map(x => typeof x === 'string' ? { text: x, owner: '', due: '' } : { text: String(x.text || ''), owner: String(x.owner || ''), due: String(x.due || '') }).filter(x => x.text),
    missed: arr(a.missed).map(String),
    coaching: arr(a.coaching).filter(x => x && (x.insight || x.suggestion)),
    communication: arr(a.communication).filter(x => x && (x.observation || x.suggestion)),
    watch: arr(a.watch).map(String),
    reflect: arr(a.reflect).map(String)
  };
}

/** Fill in title, tags and people links from the analysis without overwriting the writer's own choices. */
export function applyOrganization(id, analysis, people) {
  const row = getEntryRow(id);
  const entry = hydrateEntry(row);
  const fields = {};
  // A conversation with one person is named after them ("1:1 with Maya"); the summary carries the topics.
  const withPeople = entry.people.filter(p => p.link !== 'mentioned');
  const KIND_NAME = { one_on_one: '1:1', conversation: 'Conversation' };
  if (!entry.title.trim() && withPeople.length === 1 && KIND_NAME[entry.kind]) fields.title = `${KIND_NAME[entry.kind]} with ${withPeople[0].name.split(' ')[0]}`;
  else if (!entry.title.trim() && analysis.title) fields.title = analysis.title;
  const tags = [...new Set([...entry.tags, ...analysis.tags])];
  if (tags.length !== entry.tags.length) fields.tags = tags;
  updateEntry(id, fields);

  // People Heartwood finds in the conversation are only "mentioned": who you were with is your call
  // (picked when you recorded, or on the note). Exception: a 1:1 recorded without picking anyone.
  const linked = new Set(entry.people.map(p => p.id));
  const found = [];
  for (const name of analysis.people) {
    const n = name.toLowerCase().trim();
    let match = people.find(p => p.name.toLowerCase() === n);
    if (!match) {
      const byFirst = people.filter(p => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
      if (byFirst.length === 1) match = byFirst[0];
    }
    if (match && !linked.has(match.id)) { linked.add(match.id); found.push(match.id); }
  }
  if (!found.length) return;
  const solo = !withPeople.length && entry.kind === 'one_on_one' && found.length === 1;
  const mentioned = [...entry.people.filter(p => p.link === 'mentioned').map(p => p.id), ...(solo ? [] : found)];
  setEntryPeople(id, [...linked], { mentioned });
}

export async function processRecording(id) {
  const row = getEntryRow(id);
  if (!row?.audio_file) return;
  const file = path.join(audioDir, row.audio_file);
  const entry = hydrateEntry(row);
  const settings = getSettings();
  updateEntry(id, { status: 'transcribing', error: null });
  try {
    if (!row.audio_seconds) updateEntry(id, { audio_seconds: await probeSeconds(file) });
    const hint = [...new Set([...listPeople().map(p => p.name), settings.profile?.name].filter(Boolean))].join(', ');
    const transcript = await transcribeFile(file, { hint, kind: entry.kind, workId: id });
    updateEntry(id, { transcript, status: 'ready' });
    if (settings.delete_audio_after_transcribe && transcript.trim()) {
      await fs.rm(file, { force: true });
      updateEntry(id, { audio_file: null });
    }
  } catch (err) {
    updateEntry(id, { status: 'error', error: `Transcription failed: ${err.message}` });
    return;
  }
  if (settings.auto_analyze) {
    try { await analyzeEntry(id); } catch (err) { console.error('[auto-analyze]', err.message); }
  }
}

/** Turn one imported meeting into a clean note with a light synthesis (no coaching). */
export async function synthesizeImported(id) {
  const row = getEntryRow(id);
  if (!row) return;
  const entry = hydrateEntry(row);
  const person = entry.people[0] || null;
  const settings = getSettings();
  updateEntry(id, { status: 'analyzing', error: null });
  try {
    const { system, messages } = importSynthesisPrompt({
      text: row.source_text, date: row.created_at.slice(0, 10), heading: entry.title,
      person, profile: settings.profile, fileName: row.source_name
    });
    const { meta: a, note } = parseMetaNote(await complete({ system, messages, maxTokens: 4000, task: 'import' }));
    const analysis = { ...normalizeAnalysis(a), light: true };
    syncFollowups(id, analysis.action_items);
    updateEntry(id, {
      title: analysis.title || entry.title,
      body_md: note || row.source_text,
      tags: [...new Set([...entry.tags, ...analysis.tags])],
      analysis, analysis_at: now(), status: 'ready'
    });
  } catch (err) {
    // Keep the original text as the note so nothing is lost; offer a retry.
    updateEntry(id, { status: 'error', error: `Synthesis failed: ${err.message}`, body_md: row.body_md || row.source_text });
  }
}

/** Queue synthesis for imported entries, then one fresh brief for the person. */
export function queueImport(entryIds, personId) {
  for (const id of entryIds) enqueue(`imp:${id}`, () => synthesizeImported(id));
  if (personId) enqueue(`brief:${personId}:${Date.now()}`, () => createPersonBrief(personId));
}

/**
 * Read every attached file, write the note, then reflect, tag and link people.
 * Files already read are skipped, so adding more files to a note only reads the new ones.
 */
export async function processFiles(id, { context = '', quiet = false } = {}) {
  const row = getEntryRow(id);
  if (!row) return;
  // Your own words: stored separately for new notes; for older ones, whatever sits above the "---".
  if (!quiet && row.user_context == null) {
    const own = row.body_md.split(/\n\n---\n\n/)[0].trim();
    db.prepare('UPDATE entries SET user_context = ? WHERE id = ?').run(own, id);
    row.user_context = own;
  }
  context = context || row.user_context;
  updateEntry(id, { status: 'processing', error: null });
  const settings = getSettings();
  const people = listPeople();
  const pending = db.prepare(`SELECT * FROM entry_files WHERE entry_id = ? AND status != 'ready' ORDER BY created_at, name`).all(id);
  const setFile = db.prepare(`UPDATE entry_files SET status = ?, error = ?, extracted_text = ?, split_count = ? WHERE id = ?`);

  for (const f of pending) {
    try {
      const { text, images } = await extractFile(path.join(filesDir, f.stored), f.name);
      let out = text;
      if (images.length) {
        const pages = [];
        for (let i = 0; i < images.length; i++) {
          const { system, messages } = imageReadPrompt({ fileName: f.name, context, fileNote: f.note, page: i + 1, pages: images.length });
          messages[0].images = [images[i]];
          const read = await complete({ system, messages, maxTokens: 3000, task: 'read image' });
          pages.push(images.length > 1 ? `#### Page ${i + 1}\n${read.trim()}` : read.trim());
        }
        out = pages.join('\n\n');
      }
      // A long document with many dated sections is probably a running log (e.g. years of 1:1s).
      const splits = ['doc', 'pdf', 'text'].includes(f.kind) ? splitByDates(out).filter(s => s.date).length : 0;
      setFile.run('ready', null, out, splits >= 3 ? splits : 0, f.id);
    } catch (err) {
      console.error('[file]', f.name, err.message);
      setFile.run('error', err.message.slice(0, 300), '', 0, f.id);
    }
  }

  const files = db.prepare(`SELECT name, kind, note, extracted_text AS text FROM entry_files WHERE entry_id = ? AND status = 'ready' ORDER BY created_at, name`).all(id);
  const combined = files.map(f => `#### ${f.name}\n${f.text}`).join('\n\n');
  if (quiet) {
    // Files pasted into a note: they're read and kept with it; the note itself isn't rewritten.
    if (row.source === 'files') updateEntry(id, { source_text: combined });
    const failed = pending.length && db.prepare(`SELECT COUNT(*) n FROM entry_files WHERE entry_id = ? AND status = 'error'`).get(id).n;
    updateEntry(id, { status: 'ready', error: failed ? `${failed} file${failed > 1 ? 's' : ''} couldn’t be read. See the file list.` : null });
    return;
  }
  updateEntry(id, { source_text: combined });
  if (!files.length) {
    updateEntry(id, { status: 'error', error: 'Heartwood couldn’t read any of the files. Check the file list below.' });
    return;
  }

  try {
    const entry = hydrateEntry(getEntryRow(id));
    const { system, messages } = filesSynthesisPrompt({ files, context, profile: settings.profile, people });
    const { meta: a, note } = parseMetaNote(await complete({ system, messages, maxTokens: 8000, task: 'files note' }));
    if (!note) throw new Error('The AI returned an empty note.');
    const mine = (row.user_context || '').trim();
    const fields = {
      // Your own words stay on top; the synthesis goes underneath (replacing any earlier synthesis).
      body_md: mine ? `${mine}\n\n---\n\n${note}` : note,
      status: 'ready'
    };
    if (!entry.title.trim() && a.title) fields.title = String(a.title).slice(0, 120);
    if (entry.kind === 'note' && ['meeting', 'one_on_one'].includes(a.kind)) fields.kind = a.kind;
    updateEntry(id, fields);
    // Tags and people from the synthesis, even if reflection is turned off.
    applyOrganization(id, normalizeAnalysis({ tags: a.tags, people: a.people }), people);
    if (!settings.auto_analyze) {
      // Keep the names it found so they can be suggested as new people.
      updateEntry(id, { analysis: normalizeAnalysis({ people: a.people, tags: a.tags }), analysis_at: now() });
    }
  } catch (err) {
    updateEntry(id, { status: 'error', error: `Couldn’t write the note: ${err.message}` });
    return;
  }
  const failed = db.prepare(`SELECT COUNT(*) n FROM entry_files WHERE entry_id = ? AND status = 'error'`).get(id).n;
  if (failed) updateEntry(id, { error: `${failed} file${failed > 1 ? 's' : ''} couldn’t be read. See the file list.` });
  if (settings.auto_analyze) {
    try { await analyzeEntry(id); } catch (err) { console.error('[files-analyze]', err.message); }
  }
}

/** On boot, resume anything a restart interrupted. */
export function resumeJobs() {
  const stuck = db.prepare(`SELECT id, status, source, body_md FROM entries WHERE status IN ('transcribing','analyzing','processing')`).all();
  for (const { id, status, source, body_md } of stuck) {
    if (status === 'transcribing') enqueue(`rec:${id}`, () => processRecording(id));
    else if (status === 'processing') enqueue(`files:${id}`, () => processFiles(id));
    else if (source === 'import' && !body_md) enqueue(`imp:${id}`, () => synthesizeImported(id));
    else updateEntry(id, { status: 'ready' });
  }
}
