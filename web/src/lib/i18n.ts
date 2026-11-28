// Two languages, kept next to each other where the sentence is used: `tx("Add funds", "Para
// yatır")`. No key files — a string and its translation cannot drift apart when they sit on
// one line, and a page reads top to bottom in either language.
//
// Every builder in the first beta sessions was a Turkish speaker working through an English
// app, and each one lost time to it. The choice is remembered per browser; before one is
// made, the browser's own language decides.
import { useSyncExternalStore } from "react";

export type Lang = "en" | "tr";

const KEY = "eunomia_lang";
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // storage blocked — fall through to the browser's language
  }
  return typeof navigator !== "undefined" && /^tr\b/i.test(navigator.language ?? "") ? "tr" : "en";
}

let current: Lang = initial();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // not remembered, still applied
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Subscribe a component to the language. Call it in any component that renders `tx(…)`. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "en" as Lang);
}

/** The sentence in the current language. */
export function tx(en: string, tr: string): string {
  return current === "tr" ? tr : en;
}

/** For tests. */
export function resetLangForTest(lang: Lang = "en"): void {
  current = lang;
}
