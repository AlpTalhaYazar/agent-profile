/**
 * @module use-prefers-reduced-motion
 *
 * Reactive hook around `matchMedia("(prefers-reduced-motion: reduce)")`.
 *
 * The CSS side already collapses `--ap-duration-*` tokens and disables
 * animations under reduced motion (see `tokens.css`). This hook lets
 * imperative animations — like the View Transition API circle-reveal in the
 * theme toggle — opt out at the JS layer too.
 *
 * Returns `false` during SSR / non-DOM environments so callers can run their
 * default animation path without guarding.
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersReduced(event.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);

  return prefersReduced;
}
