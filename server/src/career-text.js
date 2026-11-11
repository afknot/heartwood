// Pure text helpers for the career record: removing names, checking drafts, writing story files.
// No database access, so they can be tested on their own.
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

const ROLE_LABEL = { direct_report: 'someone on my team', peer: 'a peer', manager: 'my manager', mentor: 'a mentor', mentee: 'someone I mentor', stakeholder: 'a stakeholder', other: 'a colleague' };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace the names of people Heartwood knows with role labels. */
export function removeNamesFrom(text, people = []) {
  let t = String(text || '').replace(/\[@([^\]]+)\]\(\/people\/[0-9a-f-]{36}\)/g, '$1');
  const names = [];
  const ambiguousFirst = new Set();
  for (const p of people) {
    const full = String(p.name || '').trim();
    if (!full) continue;
    names.push([full, p]);
    const first = full.split(/\s+/)[0];
    if (first.length <= 2) continue;
    if (people.some(o => o !== p && String(o.name || '').split(/\s+/)[0] === first)) ambiguousFirst.add(first);
    else names.push([first, p]);
  }
  names.sort((a, b) => b[0].length - a[0].length); // full names before first names
  let replaced = 0;
  for (const [n, p] of names) {
    const re = new RegExp(`\\b${escRe(n)}(['’]s)?\\b`, 'g');
    t = t.replace(re, (m, poss, offset, whole) => {
      replaced++;
      let label = (ROLE_LABEL[p.relationship] || 'a colleague') + (poss ? '’s' : '');
      const before = whole.slice(0, offset);
      if (!before.trim() || /[.!?]\s+$|\n\s*$|^\s*[-*]\s+$/.test(before.slice(-4))) label = label[0].toUpperCase() + label.slice(1);
      return label;
    });
  }
  const ambiguous = [...ambiguousFirst].filter(n => new RegExp(`\\b${escRe(n)}\\b`).test(t));
  return { text: t, replaced, ambiguous };
}

const JOB_SEEKING = /\b(open to (new )?(work|roles|opportunities)|looking for (my )?(next|a new) (role|position|opportunity|challenge)|seeking (a )?(new )?(role|position|opportunit)|job (search|hunt)|next chapter|available for (hire|new roles)|hire me|actively interviewing)\b/i;

/** Things to check before a draft leaves Heartwood. */
export function checkText(text, { replaced = 0, ambiguous = [] } = {}) {
  const t = String(text || '');
  const flags = [];
  if (ambiguous.length) flags.push({ level: 'warn', text: `More than one person in Heartwood is named ${ambiguous.join(', ')}, so those names were left in. Replace them by hand.` });
  if (replaced) flags.push({ level: 'info', text: `Replaced ${replaced} name${replaced > 1 ? 's' : ''} of people in Heartwood with role labels. Check they read naturally.` });
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) flags.push({ level: 'warn', text: 'Contains an email address.' });
  if (/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(t)) flags.push({ level: 'warn', text: 'Contains what looks like a phone number.' });
  if (JOB_SEEKING.test(t)) flags.push({ level: 'warn', text: 'Contains job-seeking language. Your employer and team can see this.' });
  const todos = (t.match(/TODO:/g) || []).length;
  if (todos) flags.push({ level: 'info', text: `${todos} TODO note${todos > 1 ? 's' : ''} to fill in. Fill them in or delete them before you publish.` });
  // Pairs of capitalized words mid-sentence may be names Heartwood doesn't know.
  const allow = /^(Product Design|Content Design|Design System|United States|New York|Human Resources)$/;
  const maybe = [...new Set([...t.matchAll(/(?<=[a-z,;:] )([A-Z][a-z]+ [A-Z][a-z]+)\b/g)].map(m => m[1]).filter(n => !allow.test(n)))].slice(0, 6);
  if (maybe.length) flags.push({ level: 'warn', text: `Possible names to check: ${maybe.join(', ')}.` });
  return flags;
}

// Values for the portfolio's front matter reader, which takes everything after "key:" literally and
// only strips one pair of surrounding quotes. So: one line, curly quotes inside, quote only when needed.
const yamlStr = s => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim().replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”');
  return /^(true|false|\d+)$/i.test(v) || /^['-]/.test(v) ? `"${v}"` : v;
};
export const slugify = s => String(s || 'story').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '') || 'story';

export const STORY_SECTIONS = ['The situation', 'The hard call', 'What I put in place', 'How the team did the work', 'What changed', 'What I’d do differently'];
export const STORY_FORMATS = ['heartwood', 'simple', 'none'];
export const RECORD_FORMATS = ['heartwood', 'jsonresume'];

/** The story headings the writer chose in Settings (one per line), or the default six. */
export function storySections(text) {
  const list = String(text || '').split('\n').map(l => l.replace(/^#+\s*/, '').trim()).filter(Boolean).slice(0, 12);
  return list.length ? list : STORY_SECTIONS;
}

/**
 * The story file. Formats:
 * - heartwood: the full front matter Heartwood's reference portfolio reads (status, stat, outcomes…)
 * - simple: title, date, summary, draft: true, which most static site generators understand
 * - none: plain Markdown, no front matter
 */
export function storyMarkdown(d, { format = 'heartwood', date = new Date().toISOString().slice(0, 10) } = {}) {
  const body = String(d.body || '').trim();
  if (format === 'none') {
    const summary = clip(d.summary, 240);
    return [`# ${clip(d.title, 80) || 'Story'}`, '', ...(summary ? [`_${summary}_`, ''] : []), body, ''].join('\n');
  }
  if (format === 'simple') {
    return ['---', `title: ${yamlStr(clip(d.title, 80))}`, `date: ${date}`, `summary: ${yamlStr(clip(d.summary, 240))}`, 'draft: true', '---', '', body, ''].join('\n');
  }
  const lines = ['---',
    `title: ${yamlStr(clip(d.title, 80))}`,
    `summary: ${yamlStr(clip(d.summary, 240))}`,
    `question: ${yamlStr(clip(d.question, 200))}`,
    `org: ${yamlStr(d.org || 'TODO: organization')}`,
    `role: ${yamlStr(d.role || 'TODO: role')}`,
    `timeframe: ${yamlStr(d.timeframe || 'TODO: timeframe')}`];
  if (d.scope) lines.push(`scope: ${yamlStr(d.scope)}`);
  lines.push('status: draft', 'featured: false', 'order: 10', 'source: heartwood');
  if (d.stat) lines.push(`stat: ${yamlStr(clip(d.stat, 16))}`);
  if (d.stat && d.stat_note) lines.push(`stat_note: ${yamlStr(clip(d.stat_note, 60))}`);
  const outcomes = (Array.isArray(d.outcomes) ? d.outcomes : []).map(o => clip(o, 200)).filter(Boolean).slice(0, 5);
  if (outcomes.length) lines.push('outcomes:', ...outcomes.map(o => `  - ${yamlStr(o)}`));
  lines.push('---', '', body, '');
  return lines.join('\n');
}

// ---------- career record (the file your resume is built from) ----------
// heartwood:  { basics: { summary }, roles: [{ id, title, org, start, end, highlights: [{ text, visibility }] }] }
// jsonresume: the JSON Resume standard (jsonresume.org): { basics: { summary }, work: [{ name, position, startDate, endDate, highlights: ["..."] }] }

/** Read either format into one shape: { summary, roles: [{ id, title, org, start, end, highlights: [{ text }] }] }. Null if it doesn't match. */
export function normalizeRecord(record, format = 'heartwood') {
  if (!record || typeof record !== 'object') return null;
  if (format === 'jsonresume') {
    if (!Array.isArray(record.work)) return null;
    return {
      summary: record.basics?.summary || '',
      roles: record.work.map((w, i) => ({
        id: `work-${i}`, title: w.position || '', org: w.name || w.company || '', start: w.startDate || '', end: w.endDate || '',
        highlights: (Array.isArray(w.highlights) ? w.highlights : []).map(h => ({ text: typeof h === 'string' ? h : String(h?.text || '') }))
      }))
    };
  }
  if (!Array.isArray(record.roles)) return null;
  return { summary: record.basics?.summary || '', roles: record.roles.map(r => ({ ...r, highlights: Array.isArray(r.highlights) ? r.highlights : [] })) };
}

/** Apply accepted resume changes to the original record, keeping its format and everything Heartwood doesn't touch. */
export function applyResumeChanges(record, format, changes = [], summary = '') {
  const next = structuredClone(record);
  const jr = format === 'jsonresume';
  const roles = jr ? next.work : next.roles;
  for (const x of changes) {
    const role = jr ? roles[Number(String(x.role_id).replace('work-', ''))] : roles.find(r => r.id === x.role_id);
    if (!role) continue;
    role.highlights ||= [];
    const item = jr ? x.text : { text: x.text, visibility: x.visibility, source: 'heartwood' };
    const at = role.highlights[x.index];
    const currentText = typeof at === 'string' ? at : at?.text;
    if (x.action === 'replace' && Number.isInteger(x.index) && currentText === x.current) role.highlights[x.index] = item;
    else role.highlights.push(item);
  }
  if (summary) next.basics = { ...next.basics, summary };
  return next;
}
