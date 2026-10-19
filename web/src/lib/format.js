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

export const isoDay = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
