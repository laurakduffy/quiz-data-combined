import { useEffect, useRef, useState } from 'react';

const ANIMATION_DURATION_MS = 300;

/**
 * Animates a credence distribution toward a target set of values using RAF.
 * Returns { thumbValues, animateTo } — caller passes thumbValues to the
 * slider's `thumbValue` prop so the thumb tweens visually while the
 * displayed percent (bound to the real value) snaps to target immediately.
 */
export function useCredenceAnimation() {
  const [thumbValues, setThumbValues] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const animateTo = (from, to) => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    // Seed synchronously so the next render after the caller's dispatch
    // still shows the starting thumb position instead of flashing to target.
    setThumbValues({ ...from });
    const keys = Object.keys(to);
    const start = window.performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ANIMATION_DURATION_MS);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const interpolated = {};
      for (const k of keys) {
        const a = from[k] || 0;
        const b = to[k] || 0;
        interpolated[k] = a + (b - a) * eased;
      }
      if (t < 1) {
        setThumbValues(interpolated);
        rafRef.current = window.requestAnimationFrame(step);
      } else {
        setThumbValues(null);
        rafRef.current = null;
      }
    };
    rafRef.current = window.requestAnimationFrame(step);
  };

  return { thumbValues, animateTo };
}
