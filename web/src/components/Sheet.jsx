import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Page scroll lock shared by every open sheet. Counted, so a sheet opened on top of another
// (e.g. the people picker over a meeting) can't leave the page frozen when they close in any order.
// Uses the position:fixed technique because iOS ignores overflow:hidden on <body>.
let locks = 0;
let savedY = 0;
function lock() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed'; b.top = `-${savedY}px`; b.left = '0'; b.right = '0'; b.width = '100%'; b.overflow = 'hidden';
}
function unlock() {
  if (locks === 0 || --locks > 0) return;
  const b = document.body.style;
  b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = ''; b.overflow = '';
  window.scrollTo(0, savedY);
}

// Open sheets, top last: only the top one handles Escape and keeps Tab focus inside it.
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sheet({ open, onClose, title, children }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    lock();
    const me = {};
    stack.push(me);
    const returnTo = document.activeElement;
    // Move focus into the sheet (unless something inside already took it, e.g. autoFocus).
    const t = setTimeout(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus(); }, 0);
    const onKey = e => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1);
      unlock();
      if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  // Rendered at the top of the page: a sheet opened from inside the tab bar or a card (anything with
  // a blur or transform) would otherwise be trapped inside it.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          {title ? <h2>{title}</h2> : <span />}
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
