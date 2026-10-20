// iPhone keeps fixed bars (the tab bar, the Ask dock, composers) pinned to the bottom of the layout
// viewport, which isn't always the bottom of the screen: after the keyboard closes, when Safari's
// toolbar shows or hides, or when the app comes back from the background, they can end up floating
// in the middle of the page until you scroll.
//
// This watches the visible viewport and:
//  - hides the tab bar while the keyboard is open (html.kb-open), so it never sits on top of what
//    you're typing;
//  - after the keyboard closes, or when the app becomes visible again, nudges the page so iOS
//    recomputes where "bottom" is.
let started = false;
export function watchViewport() {
  if (started || typeof window === 'undefined' || !window.visualViewport) return;
  started = true;
  const vv = window.visualViewport;
  const root = document.documentElement;
  let kb = false;
  const nudge = () => {
    // Re-asserting the scroll position makes iOS re-anchor position:fixed elements.
    requestAnimationFrame(() => {
      window.scrollTo(window.scrollX, window.scrollY + 1);
      window.scrollTo(window.scrollX, Math.max(0, window.scrollY - 1));
    });
  };
  const check = () => {
    const hidden = window.innerHeight - vv.height - vv.offsetTop;
    const open = hidden > 120 && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || (document.activeElement?.isContentEditable && hidden > 120);
    root.style.setProperty('--vv-gap', `${Math.max(0, Math.round(hidden))}px`);
    if (open !== kb) {
      kb = open;
      root.classList.toggle('kb-open', open);
      if (!open) nudge();
    }
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  document.addEventListener('focusout', () => setTimeout(check, 50));
  document.addEventListener('focusin', () => setTimeout(check, 300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); nudge(); } });
  window.addEventListener('pageshow', () => { check(); nudge(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { check(); nudge(); }, 300));
  check();
}
