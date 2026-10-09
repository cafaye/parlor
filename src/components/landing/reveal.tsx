"use client";

/**
 * Scroll reveal — the page's one ambient motion primitive.
 *
 * The rule this enforces: motion is an enhancement, so the DEFAULT state is
 * visible. JavaScript only ever takes that away in order to give it back with
 * intent. A visitor with scripting off, a reader with prefers-reduced-motion,
 * and a test in jsdom (which has no IntersectionObserver) all get the same
 * plain page — which is why arming happens in an effect and never in the
 * initial render.
 *
 * One observer per element, disconnected after the first intersection: a
 * reveal plays once. A section that re-hides on scroll back teaches the
 * reader to distrust what they just read.
 */

import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    el.classList.add("reveal-armed");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("reveal-in");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
