// Contrast of the design tokens, light and dark, read from src/App.css: every
// pair the interface actually uses must pass WCAG AA (text 4.5:1, control
// borders and focus 3:1). A token changed for looks that breaks a pair fails
// here, not in front of someone who reads badly.
//
//   node scripts/contrast.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "..", "src", "App.css"), "utf8");

function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) throw new Error(`blocco ${selector} non trovato in App.css`);
  const body = css.slice(i, css.indexOf("}", i));
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*rgba\(([^)]+)\)/g)) out[m[1]] = m[2].split(",").map(Number);
  return out;
}

/** A translucent tint laid over a surface, as the eye sees it. */
function over(tint, surface) {
  const [r, g, b, a] = tint;
  const s = [1, 3, 5].map((i) => parseInt(surface.slice(i, i + 2), 16));
  return "#" + [r, g, b].map((c, i) => Math.round(c * a + s[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
}
const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, backgrounds it sits on, minimum]
const TEXT = 4.5;
const UI = 3;
const surfaces = ["bg", "chrome", "panel", "panel-2", "hover"];
const pairs = [
  ["text", [...surfaces, "hover-strong", "selected"], TEXT],
  ["ink-soft", [...surfaces, "selected"], TEXT],
  ["muted", [...surfaces, "selected"], TEXT],
  ["accent", ["bg", "chrome", "panel", "selected"], TEXT],
  ["accent-2", ["bg", "chrome", "panel"], TEXT],
  ["record", ["bg", "chrome", "panel"], TEXT],
  ["amber", ["bg", "chrome", "panel"], TEXT],
  ["user-bubble-fg", ["bg"], TEXT],
  ["on-fill", ["accent-fill", "accent-fill-hover", "record-fill", "record-fill-hover"], TEXT],
  ["line-strong", ["bg", "chrome", "panel"], UI],
  ["check-border", ["bg", "panel"], UI],
  ["focus", ["bg", "chrome", "panel", "panel-2"], UI],
];

// Colored text on its own soft tint (badges, "in ritardo", active rows).
const tinted = [
  ["accent", "accent-soft"],
  ["accent-2", "accent-2-soft"],
  ["record", "record-soft"],
  ["amber", "amber-soft"],
];

let failed = 0;
for (const [name, theme] of [["chiaro", light], ["scuro", dark]]) {
  console.log(`\n${name}`);
  for (const [fg, tint] of tinted) {
    for (const surface of ["bg", "chrome", "panel"]) {
      const bg = over(theme[tint], theme[surface]);
      const r = ratio(theme[fg], bg);
      const ok = r >= TEXT;
      if (!ok) failed++;
      console.log(`  ${ok ? "ok  " : "FAIL"} --${fg} su --${tint} sopra --${surface}: ${r.toFixed(2)}:1 (minimo ${TEXT})`);
    }
  }
  for (const [fg, bgs, min] of pairs) {
    for (const bg of bgs) {
      if (!theme[fg] || !theme[bg]) {
        failed++;
        console.log(`  FAIL --${fg} su --${bg}: token mancante`);
        continue;
      }
      const r = ratio(theme[fg], theme[bg]);
      const ok = r >= min;
      if (!ok) failed++;
      console.log(`  ${ok ? "ok  " : "FAIL"} --${fg} su --${bg}: ${r.toFixed(2)}:1 (minimo ${min})`);
    }
  }
}
console.log(failed ? `\n${failed} coppie sotto la soglia` : "\nTUTTO OK: ogni coppia passa AA in chiaro e in scuro");
process.exit(failed ? 1 : 0);
