import { useEffect, useRef } from 'react';

// The Heartwood mark as live voice feedback ("Grain"): the growth rings stay put but bend like
// wood grain as you speak, more toward the outside, and relax back into circles in silence.
// The heartwood dot swells with each syllable. Draws in its own animation loop (no React
// re-render per frame) from `getLevel()`, a 0..1 loudness read each frame.

const RINGS = [
  { cx: 150, cy: 150, r: 122, amp: 9, ph: 0.0 },
  { cx: 159, cy: 146, r: 97, amp: 7.5, ph: 1.3 },
  { cx: 167, cy: 143, r: 72, amp: 6, ph: 2.6 },
  { cx: 173, cy: 141, r: 47, amp: 4.5, ph: 3.9 }
];
const DOT = { cx: 178, cy: 140, r: 17 };
const STEPS = 80;

function ringPath(b, i, t, L, S, warp, idleAmp) {
  let d = '';
  for (let k = 0; k <= STEPS; k++) {
    const a = (k / STEPS) * Math.PI * 2;
    const wobble = b.amp * warp * (L * 0.55 * Math.sin(3 * a + b.ph + t * 1.6) + S * 0.65 * Math.sin(5 * a - b.ph * 0.7 - t * 0.9) + S * 0.35 * Math.sin(2 * a + t * 0.6 + i));
    const r = b.r + wobble + idleAmp * Math.sin(2 * a + t * 0.5 + i * 0.8);
    d += `${k ? 'L' : 'M'}${(b.cx + r * Math.cos(a)).toFixed(1)} ${(b.cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

export default function GrainRings({ getLevel, paused = false, warp = 2, size = 260 }) {
  const paths = useRef([]);
  const dot = useRef(null);
  const g = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const w = reduce ? warp * 0.35 : warp;
    const idleAmp = reduce ? 0 : 0.7;
    let t = 0, L = 0, S = 0, pz = pausedRef.current ? 1 : 0, last = performance.now(), raf = 0;
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!reduce) t += dt;
      const target = pausedRef.current ? 0 : Math.max(0, Math.min(1, getLevel() || 0));
      L += (target - L) * (1 - Math.exp(-dt * (target > L ? 20 : 5)));
      S += (L - S) * (1 - Math.exp(-dt * 3)); // slower envelope: the grain flows instead of jittering
      pz += ((pausedRef.current ? 1 : 0) - pz) * (1 - Math.exp(-dt * 5));
      RINGS.forEach((b, i) => paths.current[i]?.setAttribute('d', ringPath(b, i, t, L, S, w, idleAmp)));
      dot.current?.setAttribute('r', (DOT.r * (1 + L * 0.35) + (reduce ? 0 : 0.6 * Math.sin(t * 1.25))).toFixed(2));
      if (g.current) g.current.style.opacity = String(1 - 0.45 * pz);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, warp]);

  return (
    <svg className="grain-rings" width={size} height={size} viewBox="0 0 300 300" aria-hidden="true">
      <g ref={g}>
        {RINGS.map((b, i) => (
          <path key={i} ref={el => { paths.current[i] = el; }} d={ringPath(b, i, 0, 0, 0, 0, 0)} />
        ))}
      </g>
      <circle ref={dot} cx={DOT.cx} cy={DOT.cy} r={DOT.r} />
    </svg>
  );
}
