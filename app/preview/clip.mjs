// Text cut by its own box: the tail of a "g", the bottom of a "p". It happens
// when a label has `overflow: hidden` (for the "…") and `line-height: 1`: the
// font draws its descenders below a 1em line, and the box clips them. axe does
// not see it and neither does a screenshot at 1x — on Windows at 125 % it was
// the first thing people noticed ("Registra" and "Oggi" with half a "g").
//
//   node preview/clip.mjs http://localhost:5199
//
// For every text on every screen (screens.mjs, light and dark, plus the pill
// in each state) the glyphs' box is compared with the box of each ancestor
// that clips, up to the page. Fails when a single pixel row is lost.
import { createRequire } from "node:module";
import { screens } from "./screens.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const [base = "http://localhost:5199"] = process.argv.slice(2);

function scan() {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest(".sr-only, [hidden], script, style, textarea, input")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Only the vertical axis: horizontal clipping is the "…" doing its job.
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowY === "visible" && s.overflow !== "hidden" && s.overflow !== "clip") continue;
      // Scroll containers clip on purpose (what is below is a scroll away).
      if (s.overflowY === "auto" || s.overflowY === "scroll") break;
      const b = a.getBoundingClientRect();
      const top = b.top + parseFloat(s.borderTopWidth);
      const bottom = b.bottom - parseFloat(s.borderBottomWidth);
      const lost = Math.max(top - r.top, r.bottom - bottom);
      // Only lines that are meant to be shown: a box clipping whole lines is a
      // clamp, not a cut glyph.
      if (lost >= 1 && lost < r.height * 0.6) {
        const cls = typeof a.className === "string" ? a.className.trim().split(/\s+/).join(".") : "";
        out.push(`${a.tagName.toLowerCase()}${cls ? "." + cls : ""} "${text.slice(0, 40)}" −${lost.toFixed(1)}px`);
      }
      break;
    }
  }
  return [...new Set(out)];
}

const browser = await chromium.launch();
let total = 0;
const report = (theme, name, found) => {
  total += found.length;
  console.log(`${found.length ? "  FAIL" : "  ok  "} ${theme} ${name}`);
  for (const f of found) console.log(`         ${f}`);
};

for (const theme of ["light", "dark"]) {
  const p = await browser.newPage({ viewport: { width: 1040, height: 720 }, colorScheme: theme, locale: process.env.MORI_LANG || "it-IT" });
  for await (const name of screens(p, base)) report(theme, name, await p.evaluate(scan));
  for (const pill of ["started", "stopped", "silence", "status", "transcribing", "understanding"]) {
    await p.goto(`${base}/?v=pill&pill=${pill}`);
    await p.waitForTimeout(500);
    report(theme, `pillola ${pill}`, await p.evaluate(scan));
  }
  await p.close();
}

await browser.close();
console.log(total ? `\n${total} testi tagliati` : "\nTUTTO OK: nessun testo tagliato");
process.exit(total ? 1 : 0);
