// Light, dark, or whatever Windows says. A per-device display preference, so
// it lives in localStorage (both windows share it: the pill follows the app).
// Applied before the first render, so there is no flash of the wrong theme.

export type Theme = "auto" | "light" | "dark";
const KEY = "mori.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme = getTheme()): void {
  const el = document.documentElement;
  if (t === "auto") delete el.dataset.theme;
  else el.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage refused: the choice still applies to this session */
  }
  applyTheme(t);
}
