"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Number roll — the agents surfaces' only JS-driven motion (matching the
 * mockups' `data-count`): 0 → value on mount, shown → next on update, 700ms
 * cubic ease-out. Reduced motion jumps straight to the value.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    if (reduce) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const duration = 700;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const k = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      shownRef.current = next;
      setShown(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{shown}</>;
}
