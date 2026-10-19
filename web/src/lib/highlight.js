// Find a passage of text on the page and highlight it without touching the DOM it lives in
// (the note is a live editor). Uses the CSS Custom Highlight API where available, else marks the
// paragraph that contains it.

const norm = c => (/\s/.test(c) ? ' ' : c.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"'));

/** Map the visible text under `root` to a whitespace-collapsed, lowercased string with node positions. */
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div';
function textMap(root) {
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let str = '';
  const pos = [];
  let block = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    // A new paragraph or list item reads as a space; bold or a link inside one doesn't.
    const b = n.parentElement?.closest(BLOCK) || null;
    if (block && b !== block && str && !str.endsWith(' ')) { str += ' '; pos.push([n, 0]); }
    block = b;
    for (let i = 0; i < t.length; i++) {
      const c = norm(t[i]);
      if (c === ' ' && (str.endsWith(' ') || !str)) continue;
      str += c; pos.push([n, i]);
    }
  }
  return { str, pos };
}

const squash = s => [...String(s || '')].map(norm).join('').replace(/ +/g, ' ').trim();

/** Range for `quote` inside `root`, trying the whole thing, then its start, then its end. */
export function findRange(root, quote) {
  if (!root || !quote) return null;
  const { str, pos } = textMap(root);
  const q = squash(quote);
  const tries = [q, q.slice(0, 80), q.slice(0, 40), q.slice(-40)].filter(x => x.length >= 12 || x === q);
  for (const t of tries) {
    const at = str.indexOf(t);
    if (at < 0) continue;
    // A short fragment is only trusted when it appears once.
    if (t !== q && str.indexOf(t, at + 1) >= 0) continue;
    const [sn, so] = pos[at];
    const [en, eo] = pos[Math.min(pos.length - 1, at + t.length - 1)];
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, Math.min(en.nodeValue.length, eo + 1));
    return r;
  }
  return null;
}

let marked = null;
export function clearHighlight() {
  try { window.CSS?.highlights?.delete('hw-source'); } catch { /* unsupported */ }
  marked?.classList.remove('hl-source');
  marked = null;
}

/** Highlight one or more ranges and scroll to the first. */
export function showRange(ranges) {
  const list = [].concat(ranges).filter(Boolean);
  if (!list.length) return;
  const range = list[0];
  clearHighlight();
  // Open any collapsed sections it sits in (transcript, file text).
  for (let el = range.startContainer.parentElement; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
  const HL = window.Highlight;
  if (HL && window.CSS?.highlights) window.CSS.highlights.set('hw-source', new HL(...list));
  else {
    marked = range.startContainer.parentElement?.closest('p, li, h1, h2, h3, h4, blockquote, .transcript') || null;
    marked?.classList.add('hl-source');
  }
  // Transcripts scroll inside their own box: bring the passage into view there first.
  const inner = range.startContainer.parentElement?.closest('.transcript');
  if (inner) inner.scrollTop += range.getBoundingClientRect().top - inner.getBoundingClientRect().top - 40;
  const box = range.getBoundingClientRect();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, window.scrollY + box.top - window.innerHeight * 0.3), behavior: reduce ? 'auto' : 'smooth' });
}
