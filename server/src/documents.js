// Turn an uploaded document into plain text, then split a running 1:1 doc into
// one segment per meeting by finding the dated headings.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmpDir } from './config.js';

export const ACCEPTED = ['.docx', '.pdf', '.txt', '.md', '.markdown'];

export class DocError extends Error {}

export async function extractText(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') return normalize(buffer.toString('utf8'));
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.convertToHtml({ buffer });
    return normalize(htmlToText(value));
  }
  if (ext === '.pdf') {
    const file = path.join(tmpDir, `${crypto.randomUUID()}.pdf`);
    await fs.writeFile(file, buffer);
    try {
      const text = normalize(await run('pdftotext', ['-enc', 'UTF-8', file, '-']));
      if (text.replace(/\s/g, '').length < 40) {
        throw new DocError('This PDF has no text layer (it looks scanned or photographed). Export it as text or Word and try again.');
      }
      return text;
    } finally { await fs.rm(file, { force: true }); }
  }
  throw new DocError(`Heartwood can import ${ACCEPTED.join(', ')} files.`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new DocError(`Couldn't read the PDF: ${err.slice(-200)}`))));
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
export function htmlToText(html) {
  return String(html)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${'#'.repeat(Math.min(3, Number(l) + 1))} ${t}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|li|tr|div|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

function normalize(t) {
  return String(t).replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const PATTERNS = [
  // 2024-10-03, 2024/10/03
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, map: m => [m[1], m[2], m[3]] },
  // 10/3/2024, 10-3-24 (US order)
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/, map: m => [m[3], m[1], m[2]] },
  // October 3, 2024 · Oct 3rd 2024 · Oct 3
  { re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), map: m => [m[3] || null, MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)], m[2]] },
  // 3 October 2024 · 3rd Oct
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, 'i'), map: m => [m[3] || null, MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)], m[1]] }
];

/** If this line looks like a dated heading, return { y|null, m, d, index }. */
export function dateInLine(line) {
  const clean = line.replace(/^[#>*\s_-]+/, '').replace(/[*_]+/g, '').trim();
  if (!clean || clean.length > 70) return null;
  if (/^[-•]\s/.test(line.trim())) return null; // bullets are content, not headings
  for (const p of PATTERNS) {
    const m = clean.match(p.re);
    if (!m || m.index > 25) continue;
    let [y, mo, d] = p.map(m).map(v => (v == null ? null : Number(v)));
    if (y != null && y < 100) y += 2000;
    if (!mo || mo > 12 || !d || d > 31) continue;
    if (y != null && (y < 1990 || y > 2100)) continue;
    return { y, m: mo, d };
  }
  return null;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Split a running doc into meetings. Returns [{ date, heading, text }].
 * Text before the first dated heading becomes its own undated segment (often
 * goals or a header), which the review screen lets you merge or skip.
 */
export function splitByDates(text) {
  const lines = text.split('\n');
  const marks = [];
  lines.forEach((line, i) => {
    const d = dateInLine(line);
    if (d) marks.push({ i, ...d, heading: line.replace(/^[#\s*]+/, '').replace(/\*+/g, '').trim() });
  });

  // Fill in missing years from neighbours (running docs often write "Oct 3"),
  // rolling the year over when the month/day wraps in the doc's direction.
  const known = marks.filter(mk => mk.y).map(mk => mk.y * 400 + mk.m * 32 + mk.d);
  let descending;
  if (known.length >= 2 && known[0] !== known[known.length - 1]) descending = known[0] > known[known.length - 1];
  else {
    // Not enough full dates: go by whether month/day mostly falls or rises down the doc.
    let up = 0, down = 0;
    for (let k = 1; k < marks.length; k++) {
      const a = marks[k - 1].m * 32 + marks[k - 1].d, b = marks[k].m * 32 + marks[k].d;
      if (b > a) up++; else if (b < a) down++;
    }
    descending = down >= up;
  }
  let prev = null;
  for (const mk of marks) {
    if (!mk.y && prev) {
      const later = mk.m * 32 + mk.d > prev.m * 32 + prev.d;
      mk.y = prev.y + (descending ? (later ? -1 : 0) : (later ? 0 : 1));
    }
    if (mk.y) prev = mk;
  }
  let lastYear = null;
  let nextYear = null;
  for (let k = marks.length - 1; k >= 0; k--) { if (marks[k].y) nextYear = marks[k].y; else if (nextYear) marks[k].y = nextYear; }
  for (const mk of marks) if (!mk.y) mk.y = new Date().getFullYear();

  if (marks.length === 0) return [{ date: null, heading: '', text: text.trim() }];

  const segments = [];
  const pre = lines.slice(0, marks[0].i).join('\n').trim();
  if (pre) segments.push({ date: null, heading: 'Before the first dated section', text: pre });
  marks.forEach((mk, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].i : lines.length;
    const body = lines.slice(mk.i + 1, end).join('\n').trim();
    segments.push({ date: iso(mk.y, mk.m, mk.d), heading: mk.heading, text: body });
  });
  // A dated heading with nothing under it is usually a stray date; fold it into the next.
  return segments.filter((s, idx) => s.text || idx === segments.length - 1);
}

export const hashText = t => crypto.createHash('sha256').update(String(t).replace(/\s+/g, ' ').trim()).digest('hex');
