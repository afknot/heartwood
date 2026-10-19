// Read any file you attach to a note: documents, decks, spreadsheets, PDFs and photos.
// Text-based files are converted locally; photos and scanned pages are prepared as
// images so the AI can read handwriting, sticky notes and whiteboards.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmpDir } from './config.js';
import { htmlToText } from './documents.js';

export const FILE_TYPES = {
  doc: ['.docx'],
  pdf: ['.pdf'],
  slides: ['.pptx'],
  sheet: ['.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv'],
  text: ['.txt', '.md', '.markdown'],
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']
};
export const ACCEPTED_EXT = Object.values(FILE_TYPES).flat();
export function fileKind(name) {
  const ext = path.extname(name || '').toLowerCase();
  return Object.entries(FILE_TYPES).find(([, exts]) => exts.includes(ext))?.[0] || null;
}

const MAX_TEXT = 60000;
const MAX_PDF_PAGES_AS_IMAGES = 10;

function run(cmd, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    const out = []; let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => {
      const buf = Buffer.concat(out);
      code === 0 ? resolve(binary ? buf : buf.toString('utf8')) : reject(new Error(`${cmd} failed: ${err.slice(-300)}`));
    });
  });
}

const clip = t => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n…[truncated]' : t);
const tidy = t => String(t).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Shrink a photo to a JPEG the AI can read (max 1600px). Handles HEIC from iPhones. */
async function toJpeg(file) {
  const work = path.join(tmpDir, crypto.randomUUID());
  let src = file;
  if (/\.(heic|heif)$/i.test(file)) {
    src = `${work}.src.jpg`;
    await run('heif-convert', ['-q', '92', file, src]);
  }
  const out = `${work}.jpg`;
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-vf', "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease", '-frames:v', '1', '-q:v', '3', out]);
  const data = (await fs.readFile(out)).toString('base64');
  await Promise.all([fs.rm(out, { force: true }), src !== file ? fs.rm(src, { force: true }) : null]);
  return { mime: 'image/jpeg', data };
}

// ---------- spreadsheets ----------
async function sheetToText(file) {
  const mod = await import('xlsx');
  const XLSX = mod.read ? mod : mod.default;
  const wb = XLSX.read(await fs.readFile(file), { type: 'buffer', cellDates: true, dense: true });
  const parts = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false });
    if (!rows.length) continue;
    const width = Math.min(40, Math.max(...rows.slice(0, 300).map(r => r.length)));
    const cell = v => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 120);
    const lines = rows.slice(0, 300).map(r => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`);
    if (lines.length > 1) lines.splice(1, 0, `|${' --- |'.repeat(width)}`);
    parts.push(`### Sheet: ${name}${rows.length > 300 ? ` (first 300 of ${rows.length} rows)` : ''}\n\n${lines.join('\n')}`);
  }
  return parts.join('\n\n') || '(empty spreadsheet)';
}

// ---------- slides ----------
function slideText(xml) {
  // Keep paragraph breaks: collect <a:t> runs per <a:p>.
  return (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
    .map(p => (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map(t => t.replace(/<\/?a:t>/g, '')).join(''))
    .map(decodeXml).filter(l => l.trim()).join('\n');
}
const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

async function pptxToText(file) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const num = n => Number(n.match(/(\d+)\.xml$/)?.[1] || 0);
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out = [];
  for (const s of slides) {
    const n = num(s);
    const body = slideText(await zip.file(s).async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? slideText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    out.push(`### Slide ${n}\n${body || '(no text)'}${notes ? `\n\n_Speaker notes:_ ${notes}` : ''}`);
  }
  return out.join('\n\n') || '(no slide text)';
}

/**
 * Extract what we can from one file.
 * @returns {{ kind: string, text: string, images: {mime,data}[] }}
 *   images are pages/photos that still need the AI to read them.
 */
export async function extractFile(file, name) {
  const kind = fileKind(name);
  if (kind === 'text') return { kind, text: clip(tidy(await fs.readFile(file, 'utf8'))), images: [] };
  if (kind === 'doc') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.convertToHtml({ path: file });
    return { kind, text: clip(tidy(htmlToText(value))), images: [] };
  }
  if (kind === 'sheet') return { kind, text: clip(await sheetToText(file)), images: [] };
  if (kind === 'slides') return { kind, text: clip(tidy(await pptxToText(file))), images: [] };
  if (kind === 'image') return { kind, text: '', images: [await toJpeg(file)] };
  if (kind === 'pdf') {
    const text = tidy(await run('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-']).catch(() => ''));
    if (text.replace(/\s/g, '').length >= 80) return { kind, text: clip(text), images: [] };
    // Scanned / photographed PDF: render the first pages as images for the AI to read.
    const prefix = path.join(tmpDir, crypto.randomUUID());
    await run('pdftoppm', ['-r', '110', '-jpeg', '-l', String(MAX_PDF_PAGES_AS_IMAGES), file, prefix]);
    const dir = path.dirname(prefix), base = path.basename(prefix);
    const pages = (await fs.readdir(dir)).filter(f => f.startsWith(base)).sort();
    const images = [];
    for (const p of pages) {
      const full = path.join(dir, p);
      images.push(await toJpeg(full));
      await fs.rm(full, { force: true });
    }
    return { kind, text: '', images };
  }
  throw new Error(`Unsupported file type: ${name}`);
}

/** Square-crop a photo to a 256px JPEG avatar (handles HEIC from iPhones). */
export async function makeAvatar(src, originalName, out) {
  let input = src;
  let tmp = null;
  if (/\.(heic|heif)$/i.test(originalName || '')) {
    tmp = path.join(tmpDir, `${crypto.randomUUID()}.jpg`);
    await run('heif-convert', ['-q', '92', src, tmp]);
    input = tmp;
  }
  try {
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
      '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=256:256", '-frames:v', '1', '-q:v', '3', out]);
  } finally { if (tmp) await fs.rm(tmp, { force: true }); }
}
