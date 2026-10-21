// Career record: evidence of the writer's own work, and drafts built from it.
// Privacy model:
//   1. Entries stay private, always.
//   2. Evidence is private too, but only about the writer, and only kept once the writer confirms it.
//   3. Drafts leave Heartwood only when the writer exports or copies them, after names are removed
//      and anything risky is flagged.
import { db, newId, now, hydrateEntry, getSettings, listPeople, safeJson } from './db.js';
import { config } from './config.js';
import { complete } from './llm.js';
import { evidencePrompt, evidenceCombinePrompt, storyDraftPrompt, resumeDraftPrompt, linkedinKitPrompt, recognitionPrompt, CAREER_THEMES } from './prompts.js';
import { fitToBudget, latestGrowth } from './briefs.js';
import { removeNamesFrom, checkText, storyMarkdown, slugify } from './career-text.js';
export { slugify };

export class CareerError extends Error {}

const KINDS = ['initiative', 'outcome', 'leadership', 'decision', 'feedback', 'learning', 'result', 'built'];
const ymd = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

// ---------- evidence ----------
export const evidenceOut = r => r && ({
  ...r, public_ok: !!r.public_ok, entry_ids: safeJson(r.entry_ids, []), used_in: safeJson(r.used_in, []),
  entries: safeJson(r.entry_ids, []).map(id => db.prepare('SELECT id, title, created_at FROM entries WHERE id = ?').get(id)).filter(Boolean)
});

export function listEvidence(status) {
  const rows = status
    ? db.prepare('SELECT * FROM evidence WHERE status = ? ORDER BY COALESCE(date, created_at) DESC').all(status)
    : db.prepare("SELECT * FROM evidence WHERE status != 'dismissed' ORDER BY COALESCE(date, created_at) DESC").all();
  return rows.map(evidenceOut);
}

export async function extractEvidence({ fromIso, toIso }) {
  const rows = db.prepare('SELECT * FROM entries WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC').all(fromIso, toIso);
  if (!rows.length) throw new CareerError('No entries in that range yet.');
  const entries = fitToBudget(rows.map(r => hydrateEntry(r)), 2600);
  const known = new Set(entries.map(e => e.id));
  const existing = db.prepare("SELECT text FROM evidence WHERE status != 'dismissed' ORDER BY created_at DESC LIMIT 300").all().map(r => r.text);
  const { system, messages } = evidencePrompt({ entries, profile: getSettings().profile, existing });
  const out = await complete({ system, messages, json: true, maxTokens: 6000, task: 'career' });
  const seen = new Set(existing.map(t => t.toLowerCase()));
  const ins = db.prepare(`INSERT INTO evidence(id, kind, text, detail, theme, date, metric, status, entry_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?)`);
  const added = [];
  db.transaction(() => {
    for (const x of (Array.isArray(out?.items) ? out.items : []).slice(0, 12)) {
      const text = clip(x.text, 400);
      const ids = (Array.isArray(x.entry_ids) ? x.entry_ids : []).filter(id => known.has(id)).slice(0, 8);
      if (!text || !ids.length || seen.has(text.toLowerCase())) continue; // must cite real entries
      seen.add(text.toLowerCase());
      const id = newId(), t = now();
      const firstEntry = entries.find(e => e.id === ids[0]);
      ins.run(id, KINDS.includes(x.kind) ? x.kind : 'outcome', text, clip(x.detail, 800),
        CAREER_THEMES.includes(x.theme) ? x.theme : 'Other', ymd(x.date) || firstEntry?.created_at.slice(0, 10) || null,
        clip(x.metric, 120), JSON.stringify(ids), t, t);
      added.push(id);
    }
  })();
  return { added: added.length, scanned: entries.length, items: added.map(id => evidenceOut(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id))) };
}

/**
 * Combine the suggestions you haven't reviewed into fewer, bigger items (initiatives, outcomes,
 * leadership patterns). Each new item cites every note its parts came from; the small ones it
 * replaces are dismissed (you can still find them by searching your notes). Kept items aren't touched.
 */
export async function combineEvidence() {
  const items = db.prepare("SELECT * FROM evidence WHERE status = 'suggested' ORDER BY COALESCE(date, created_at)").all().map(evidenceOut);
  if (items.length < 3) throw new CareerError('There aren’t enough new suggestions to combine.');
  const kept = db.prepare("SELECT text FROM evidence WHERE status = 'confirmed' ORDER BY created_at DESC LIMIT 200").all().map(r => r.text);
  const { system, messages } = evidenceCombinePrompt({ items: items.slice(0, 150), profile: getSettings().profile, kept });
  const out = await complete({ system, messages, json: true, maxTokens: 6000, task: 'career' });
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const ins = db.prepare(`INSERT INTO evidence(id, kind, text, detail, theme, date, metric, status, entry_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?)`);
  const dismiss = db.prepare("UPDATE evidence SET status = 'dismissed', updated_at = ? WHERE id = ? AND status = 'suggested'");
  const created = [];
  const considered = new Set(items.slice(0, 150).map(i => i.id));
  db.transaction(() => {
    for (const x of (Array.isArray(out?.items) ? out.items : []).slice(0, 15)) {
      const from = (Array.isArray(x.from) ? x.from : []).filter(id => byId[id]);
      const text = clip(x.text, 400);
      if (!text || !from.length) continue;
      const ids = [...new Set(from.flatMap(id => byId[id].entry_ids))].slice(0, 20);
      const id = newId(), t = now();
      const latest = from.map(f => byId[f].date).filter(Boolean).sort().at(-1) || null;
      ins.run(id, KINDS.includes(x.kind) ? x.kind : 'outcome', text, clip(x.detail, 800), CAREER_THEMES.includes(x.theme) ? x.theme : 'Other',
        ymd(x.date) || latest, clip(x.metric, 120), JSON.stringify(ids), t, t);
      created.push(id);
    }
    if (!created.length) return;
    const t = now();
    for (const id of considered) dismiss.run(t, id);
  })();
  if (!created.length) throw new CareerError('Couldn’t find bigger stories in these yet. Keep the ones that matter and dismiss the rest.');
  return { combined: considered.size, created: created.length, items: created.map(id => evidenceOut(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id))) };
}

export function updateEvidence(id, b = {}) {
  const row = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  if (!row) throw new CareerError('Not found');
  const f = {};
  if (typeof b.text === 'string' && b.text.trim()) f.text = clip(b.text, 400);
  if (typeof b.detail === 'string') f.detail = clip(b.detail, 800);
  if (typeof b.metric === 'string') f.metric = clip(b.metric, 120);
  if (CAREER_THEMES.includes(b.theme)) f.theme = b.theme;
  if (KINDS.includes(b.kind)) f.kind = b.kind;
  if (['suggested', 'confirmed', 'dismissed'].includes(b.status)) f.status = b.status;
  if (typeof b.public_ok === 'boolean') f.public_ok = b.public_ok ? 1 : 0;
  if (b.date === null || ymd(b.date)) f.date = b.date;
  const keys = Object.keys(f);
  if (!keys.length) return evidenceOut(row);
  db.prepare(`UPDATE evidence SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map(k => f[k]), now(), id);
  return evidenceOut(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id));
}

/** Add evidence by hand (no AI). */
export function addEvidence(b = {}) {
  const text = clip(b.text, 400);
  if (!text) throw new CareerError('Write what you did.');
  const id = newId(), t = now();
  db.prepare(`INSERT INTO evidence(id, kind, text, detail, theme, date, metric, status, public_ok, entry_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, '[]', ?, ?)`)
    .run(id, KINDS.includes(b.kind) ? b.kind : 'result', text, clip(b.detail, 800), CAREER_THEMES.includes(b.theme) ? b.theme : 'Other',
      ymd(b.date) || t.slice(0, 10), clip(b.metric, 120), b.public_ok ? 1 : 0, t, t);
  return evidenceOut(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id));
}

// ---------- privacy checks (pure functions live in career-text.js so they can be tested) ----------
export const removeNames = (text) => removeNamesFrom(text, listPeople());
export { checkText };

// ---------- GitHub (portfolio repo) ----------
export function githubStatus() {
  const c = getSettings().career || {};
  return { token: !!config.githubToken, repo: c.repo || '', branch: c.branch || 'main', ready: !!(config.githubToken && c.repo) };
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.githubToken}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'heartwood', ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  const data = text ? safeJson(text, { message: text }) : null;
  if (!res.ok) {
    const err = new CareerError(res.status === 401 || res.status === 403
      ? 'GitHub refused the request. Check that GITHUB_TOKEN can read and write contents and pull requests on your portfolio repo.'
      : `GitHub error ${res.status}: ${data?.message || 'unknown'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function repoOrThrow() {
  const s = githubStatus();
  if (!s.token) throw new CareerError('Add GITHUB_TOKEN to .env and restart Heartwood to export.');
  if (!s.repo) throw new CareerError('Set your portfolio repository in Settings → Career record.');
  return s;
}

const encPath = p => p.split('/').map(encodeURIComponent).join('/');

async function readRepoFile(path, ref) {
  const { repo } = repoOrThrow();
  try {
    const f = await gh('GET', `/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    return { sha: f.sha, text: Buffer.from(f.content || '', 'base64').toString('utf8') };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function readCareerRecord() {
  const { branch } = repoOrThrow();
  const path = getSettings().career.record_path;
  const f = await readRepoFile(path, branch);
  if (!f) throw new CareerError(`Couldn't find ${path} in your portfolio repo.`);
  return { ...f, record: safeJson(f.text, null) };
}

/** Create a branch, commit files to it, and open a pull request. Never touches the main branch. */
async function openPullRequest({ files, title, body, slug }) {
  const { repo, branch: base } = repoOrThrow();
  const head = `heartwood/${slug}-${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`;
  const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${head}`, sha: ref.object.sha });
  for (const f of files) {
    const existing = await readRepoFile(f.path, head);
    await gh('PUT', `/repos/${repo}/contents/${encPath(f.path)}`, {
      message: f.message || title, branch: head, content: Buffer.from(f.content, 'utf8').toString('base64'),
      ...(existing ? { sha: existing.sha } : {})
    });
  }
  const pr = await gh('POST', `/repos/${repo}/pulls`, { title, head, base, body });
  return pr.html_url;
}

// ---------- drafts ----------
export const draftOut = r => r && ({
  ...r, flags: safeJson(r.flags, []), evidence_ids: safeJson(r.evidence_ids, []),
  content: r.kind === 'story' ? r.content : safeJson(r.content, {})
});

function pickEvidence(ids) {
  const rows = Array.isArray(ids) && ids.length
    ? ids.map(id => db.prepare("SELECT * FROM evidence WHERE id = ? AND status = 'confirmed'").get(id)).filter(Boolean)
    : db.prepare("SELECT * FROM evidence WHERE status = 'confirmed' ORDER BY COALESCE(date, created_at) DESC LIMIT 120").all();
  if (!rows.length) throw new CareerError('Confirm some evidence first. Drafts are built only from evidence you’ve kept.');
  return rows.map(r => ({ ...r, public_ok: !!r.public_ok }));
}

function saveDraft({ kind, title, content, flags, evidence }) {
  const id = newId(), t = now();
  db.prepare(`INSERT INTO career_drafts(id, kind, title, content, flags, evidence_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, kind, clip(title, 200), typeof content === 'string' ? content : JSON.stringify(content), JSON.stringify(flags), JSON.stringify(evidence.map(e => e.id)), t, t);
  const mark = db.prepare('SELECT used_in FROM evidence WHERE id = ?');
  const upd = db.prepare('UPDATE evidence SET used_in = ? WHERE id = ?');
  db.transaction(() => { for (const e of evidence) upd.run(JSON.stringify([...new Set([...safeJson(mark.get(e.id)?.used_in, []), id])]), e.id); })();
  return draftOut(db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(id));
}

export async function createDraft({ kind, angle = '', evidenceIds = [], current = '', personId = '', win = '' }) {
  const profile = getSettings().profile;
  if (kind === 'recognition') {
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
    if (!person) throw new CareerError('Pick the person you want to recognize.');
    const what = clip(win, 800);
    if (!what) throw new CareerError('Say what you want to recognize them for.');
    const wins = (latestGrowth(person.id)?.timeline || []).filter(t => t.type === 'win' || t.type === 'milestone').slice(-8).map(t => t.text);
    const { system, messages } = recognitionPrompt({ person, win: what, wins, profile });
    const d = await complete({ system, messages, json: true, maxTokens: 2000, task: 'career' });
    // Their name stays (that's the point). Everyone else's is replaced.
    const others = listPeople().filter(p => p.id !== person.id);
    const post = removeNamesFrom(clip(d?.post, 1500), others);
    const rec = removeNamesFrom(clip(d?.recommendation, 1500), others);
    const content = { person_id: person.id, person_name: person.name, win: what, post: post.text, recommendation: rec.text, notes: clip(d?.notes, 600) };
    const flags = [
      { level: 'warn', text: `Ask ${person.name.split(' ')[0]} before you post. Some people prefer not to be recognized publicly.` },
      ...checkText(`${content.post}\n${content.recommendation}`, { replaced: post.replaced + rec.replaced, ambiguous: [...new Set([...post.ambiguous, ...rec.ambiguous])] })
    ];
    return saveDraft({ kind, title: `Kudos for ${person.name}`, content, flags, evidence: [] });
  }
  if (kind === 'story') {
    const evidence = pickEvidence(evidenceIds);
    const { system, messages } = storyDraftPrompt({ evidence, profile, angle: clip(angle, 500) });
    const d = await complete({ system, messages, json: true, maxTokens: 6000, task: 'career' });
    const { text, replaced, ambiguous } = removeNames(storyMarkdown(d || {}));
    const flags = checkText(text, { replaced, ambiguous });
    if (evidence.some(e => !e.public_ok)) flags.unshift({ level: 'warn', text: 'Uses evidence you haven’t marked as OK to share publicly. Review those details.' });
    return saveDraft({ kind, title: d?.title || 'Story draft', content: text, flags, evidence });
  }
  if (kind === 'resume') {
    const evidence = pickEvidence(evidenceIds);
    const { record } = await readCareerRecord();
    if (!record?.roles) throw new CareerError('The career record in your portfolio repo isn’t in the expected format.');
    const { system, messages } = resumeDraftPrompt({ evidence, profile, record });
    const d = await complete({ system, messages, json: true, maxTokens: 5000, task: 'career' });
    const roleIds = new Set(record.roles.map(r => r.id));
    const evIds = new Set(evidence.map(e => e.id));
    const changes = (Array.isArray(d?.changes) ? d.changes : []).slice(0, 8).map(c => {
      const { text, replaced, ambiguous } = removeNames(clip(c.text, 400));
      const role = record.roles.find(r => r.id === c.role_id);
      return {
        role_id: c.role_id, role_label: role ? `${role.title}, ${role.org}` : '', action: c.action === 'replace' ? 'replace' : 'add',
        index: Number.isInteger(c.index) ? c.index : null, current: c.action === 'replace' && role ? role.highlights?.[c.index]?.text || '' : '',
        text, visibility: c.visibility === 'public' ? 'public' : 'resume', why: clip(c.why, 200),
        evidence_ids: (c.evidence_ids || []).filter(id => evIds.has(id)), accepted: true, names_replaced: replaced, ambiguous
      };
    }).filter(c => roleIds.has(c.role_id) && c.text && !(c.action === 'replace' && !c.current));
    const summary = clip(d?.summary, 1200);
    const flags = checkText([summary, ...changes.map(c => c.text)].join('\n'), { replaced: changes.reduce((n, c) => n + c.names_replaced, 0), ambiguous: [...new Set(changes.flatMap(c => c.ambiguous))] });
    for (const c of changes) { delete c.ambiguous; }
    if (!changes.length && !summary) flags.push({ level: 'info', text: 'Your resume already reflects this evidence. Nothing to change.' });
    return saveDraft({ kind, title: `Resume updates, ${now().slice(0, 10)}`, content: { changes, summary, summary_accepted: !!summary }, flags, evidence });
  }
  if (kind === 'linkedin') {
    const evidence = pickEvidence(evidenceIds);
    let record = null;
    if (githubStatus().ready) { try { record = (await readCareerRecord()).record; } catch { /* the kit still works without it */ } }
    const { system, messages } = linkedinKitPrompt({ evidence, profile, record, current: clip(current, 6000) });
    const d = await complete({ system, messages, json: true, maxTokens: 4000, task: 'career' });
    const fix = s => removeNames(clip(s, 3000));
    const parts = {
      headline: fix(clip(d?.headline, 220)), about: fix(d?.about),
      bullets: (d?.experience?.bullets || []).slice(0, 6).map(b => fix(clip(b, 300))),
      posts: (d?.posts || []).slice(0, 2).map(p => ({ idea: clip(p.idea, 200), draft: fix(clip(p.draft, 1200)) }))
    };
    const content = {
      headline: parts.headline.text, about: parts.about.text,
      experience: { title: clip(d?.experience?.title, 120), org: clip(d?.experience?.org, 120), bullets: parts.bullets.map(b => b.text) },
      posts: parts.posts.map(p => ({ idea: p.idea, draft: p.draft.text })), notes: clip(d?.notes, 600)
    };
    const all = [parts.headline, parts.about, ...parts.bullets, ...parts.posts.map(p => p.draft)];
    const replaced = all.reduce((n, x) => n + x.replaced, 0);
    const ambiguous = [...new Set(all.flatMap(x => x.ambiguous))];
    const flags = checkText([content.headline, content.about, ...content.experience.bullets, ...content.posts.map(p => p.draft)].join('\n'), { replaced, ambiguous });
    return saveDraft({ kind, title: `LinkedIn update kit, ${now().slice(0, 10)}`, content, flags, evidence });
  }
  throw new CareerError('Unknown draft type.');
}

export function updateDraft(id, b = {}) {
  const row = db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(id);
  if (!row) throw new CareerError('Not found');
  let content = row.content;
  if (b.content !== undefined) {
    if (row.kind === 'story') content = clip(b.content, 60000);
    else if (b.content && typeof b.content === 'object') content = JSON.stringify(b.content).slice(0, 60000);
  }
  const text = row.kind === 'story' ? content : JSON.stringify(safeJson(content, {}));
  const flags = checkText(text);
  db.prepare('UPDATE career_drafts SET content = ?, title = ?, flags = ?, updated_at = ? WHERE id = ?')
    .run(content, typeof b.title === 'string' && b.title.trim() ? clip(b.title, 200) : row.title, JSON.stringify(flags), now(), id);
  return draftOut(db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(id));
}

export async function exportDraft(id) {
  const row = db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(id);
  if (!row) throw new CareerError('Not found');
  const s = getSettings().career;
  let url;
  if (row.kind === 'story') {
    const title = (row.content.match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || row.title;
    let slug = slugify(title);
    const { branch } = repoOrThrow();
    if (await readRepoFile(`${s.story_dir}/${slug}.md`, branch)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    url = await openPullRequest({
      slug, title: `Story draft: ${title}`,
      files: [{ path: `${s.story_dir}/${slug}.md`, content: row.content, message: `Add story draft from Heartwood: ${title}` }],
      body: `A story draft exported from Heartwood.\n\n- Arrives as \`status: draft\`, so it shows on staging only.\n- Names of people Heartwood knows were replaced with role labels.\n- Fill in any \`TODO:\` notes, then set \`status: published\`.\n\nChecks at export:\n${safeJson(row.flags, []).map(f => `- ${f.text}`).join('\n') || '- None'}`
    });
  } else if (row.kind === 'resume') {
    const c = safeJson(row.content, {});
    const accepted = (c.changes || []).filter(x => x.accepted);
    if (!accepted.length && !(c.summary && c.summary_accepted)) throw new CareerError('Pick at least one change to export.');
    const { record } = await readCareerRecord();
    const next = structuredClone(record);
    for (const x of accepted) {
      const role = next.roles.find(r => r.id === x.role_id);
      if (!role) continue;
      role.highlights ||= [];
      const item = { text: x.text, visibility: x.visibility, source: 'heartwood' };
      if (x.action === 'replace' && Number.isInteger(x.index) && role.highlights[x.index]?.text === x.current) role.highlights[x.index] = item;
      else role.highlights.push(item);
    }
    if (c.summary && c.summary_accepted) next.basics = { ...next.basics, summary: c.summary };
    url = await openPullRequest({
      slug: 'resume-updates', title: 'Resume updates from Heartwood',
      files: [{ path: s.record_path, content: JSON.stringify(next, null, 2) + '\n', message: 'Update career record from Heartwood' }],
      body: `Suggested resume updates you approved in Heartwood.\n\n${accepted.map(x => `- **${x.action === 'replace' ? 'Replace' : 'Add'}** (${x.role_label || x.role_id}): ${x.text}`).join('\n')}${c.summary && c.summary_accepted ? `\n- **New summary:** ${c.summary}` : ''}\n\nMerging regenerates the resume. Items marked \`resume\` never appear on the public site.`
    });
  } else {
    throw new CareerError('You copy this draft into LinkedIn yourself. There’s nothing to export.');
  }
  db.prepare("UPDATE career_drafts SET status = 'exported', pr_url = ?, updated_at = ? WHERE id = ?").run(url, now(), id);
  return draftOut(db.prepare('SELECT * FROM career_drafts WHERE id = ?').get(id));
}
