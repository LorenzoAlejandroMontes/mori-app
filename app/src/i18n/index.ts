// Two languages, one source: the Italian text IS the key. A view writes
// t("Registra la call") and reads like it always did; in English the same
// call returns the entry of the dictionary (src/i18n/en/*.ts). A missing entry
// falls back to the Italian, and scripts/checks.mjs fails on it — so a new
// string cannot ship untranslated without anyone noticing.
//
// The language is a per-device display preference, like the theme: it lives in
// localStorage (both windows read it) and changing it reloads the window, so
// labels computed once at import time (sections, presets) follow too.
import { EN } from "./en";

export type Lang = "it" | "en";
export type LangPref = "auto" | Lang;
const KEY = "mori.lang";

function systemLang(): Lang {
  try {
    const l = (navigator.languages?.[0] || navigator.language || "it").toLowerCase();
    return l.startsWith("it") ? "it" : "en";
  } catch {
    return "it";
  }
}

export function getLangPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "it" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

let _lang: Lang = (() => {
  const p = getLangPref();
  return p === "auto" ? systemLang() : p;
})();

export function lang(): Lang {
  return _lang;
}

/** For tests and the pill: switch without a reload. */
export function useLangNow(l: Lang): void {
  _lang = l;
  try {
    document.documentElement.lang = l;
  } catch {
    /* no DOM (checks.mjs) */
  }
}

export function setLangPref(p: LangPref): void {
  try {
    if (p === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* storage refused: the choice applies to this session only */
  }
  _lang = p === "auto" ? systemLang() : p;
}

/** BCP 47 locale for dates and numbers. */
export function locale(): string {
  return _lang === "en" ? "en-GB" : "it-IT";
}

/**
 * The text in the current language. `{name}` placeholders are filled from
 * `vars`, in both languages, so the Italian key keeps them too.
 */
export function t(it: string, vars?: Record<string, string | number>): string {
  const s = _lang === "en" ? (EN[it] ?? it) : it;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * One Italian word, two English ones: "Annulla" undoes an action ("Undo") or
 * closes a dialog ("Cancel"). The dictionary can hold only one, so the rare
 * ambiguous label says its English right where it is used.
 */
export function tx(it: string, en: string): string {
  return _lang === "en" ? en : it;
}

/**
 * Appended to every prompt that writes something the user will read (summary,
 * to-dos, brief, follow-up, chat). The prompts stay Italian — they were tuned
 * and verified on real calls — and the model is told which language to answer
 * in. Empty in Italian, so nothing changes there.
 */
export function answerLanguageNote(): string {
  return _lang === "en"
    ? "\n\nLANGUAGE: write every text meant for the user (titles, summary and its section headings, actions, memories, decisions, answers, emails) in ENGLISH, even though these instructions and the transcript are in Italian. Keep quotes copied from the transcript verbatim, in their original language. JSON keys and enum values stay exactly as specified."
    : "";
}

/** Singular or plural by count: tn(n, "{n} call", "{n} call"). */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

try {
  document.documentElement.lang = _lang;
} catch {
  /* no DOM */
}
