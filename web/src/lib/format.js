import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const KINDS = {
  note: 'Note',
  memo: 'Voice memo',
  conversation: 'Conversation',
  one_on_one: '1:1',
  meeting: 'Meeting'
};

export const RELATIONSHIPS = {
  direct_report: 'Direct report',
  peer: 'Peer',
  manager: 'Manager',
  mentor: 'Mentor',
  mentee: 'Mentee',
  stakeholder: 'Stakeholder',
  other: 'Other'
};

export function formatDate(iso, { time = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let day;
  if (same(d, today)) day = 'Today';
  else if (same(d, y)) day = 'Yesterday';
  else day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return time ? `${day}, ${t}` : day;
}

export function dayKey(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function duration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || '', { breaks: true }));
}

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REF_LINK = { entry: id => `/entry/${id}`, person: id => `/people/${id}`, schedule: id => `/schedule?edit=${id}`, meeting: id => `/?meeting=${encodeURIComponent(id)}` };

/**
 * An AI answer as safe HTML, with its [E3] / [P2] / [R1] / [M1] labels as links to what they cite.
 * The links go in before sanitizing, so nothing is added to the HTML after it's been cleaned.
 */
export function renderAnswer(content, sources = []) {
  const map = Object.fromEntries((sources || []).map(s => [s.ref, s]));
  const md = String(content || '').replace(/\[([EPRM]\d+)\]/g, (all, ref) => {
    const s = map[ref];
    const type = s?.type || 'entry';
    if (!s || !REF_LINK[type]) return '';
    const to = REF_LINK[type](s.id);
    const label = type === 'entry' ? (s.title || 'note').slice(0, 28) : s.title;
    return `<a class="ref ref-${escHtml(type)}" href="${escHtml(to)}" data-go="${escHtml(to)}" title="${escHtml(s.title || '')}">${escHtml(label || ref)}</a>`;
  });
  return renderMarkdown(md);
}

/** A link from data, only if it's https (never javascript: or data: URLs). */
export const safeHref = u => { try { return new URL(u).protocol === 'https:' ? u : undefined; } catch { return undefined; } };

/** Follow an in-app link from rendered answers; anything that isn't a path inside Heartwood is ignored. */
export const inAppPath = p => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : null);

export const isoDay = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
