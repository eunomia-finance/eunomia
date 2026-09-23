import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "eunomia-theme";
const SWEEP_MS = 900;

/** Light is the default and dark is a preference — that decision is in the landing spec.
 *
 *  The attribute is set on the document (not the landing root) because the app shell reads
 *  the same tokens; index.html applies the stored choice before first paint so neither
 *  surface flashes the wrong palette. Only an explicit in-app choice overrides the light
 *  default — the OS preference is deliberately not consulted, so every first visit opens
 *  in the brand palette. */
export function useTheme(): { theme: Theme; toggle: (e?: { clientX: number; clientY: number }) => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // Private mode / blocked storage: the light default stands.
    }
    return "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // Not being able to remember the choice is not a reason to fail setting it.
    }
  }, [theme]);

  /** Flip the palette as a circle opening from wherever the switch was pressed, rather than
   *  the whole page changing at once. The new theme is painted as a View Transition layer and
   *  revealed by a growing clip-path, so the old palette stays underneath while it sweeps.
   *
   *  Falls back to an instant flip wherever the API is missing (Firefox today) or where the
   *  visitor has asked for reduced motion — the state change is identical either way, only
   *  the reveal differs. */
  const toggle = useCallback((e?: { clientX: number; clientY: number }) => {
    const flip = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    }).startViewTransition;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!start || reduced || !e) {
      flip();
      return;
    }

    // Radius to the furthest corner, so the circle finishes by covering the viewport rather
    // than stopping short of it.
    const x = e.clientX;
    const y = e.clientY;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    // The browser snapshots the new state as soon as this callback returns, and setTheme only
    // schedules a render — the attribute would land later, in the effect, leaving both
    // snapshots identical and the sweep revealing nothing. Write it here, synchronously.
    const transition = start.call(document, () => {
      const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    });
    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration: SWEEP_MS,
          easing: "cubic-bezier(0.33, 0, 0.15, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }, []);

  return { theme, toggle };
}
