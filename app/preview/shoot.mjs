// Screenshots of every main screen of the preview bench, light and dark — the
// "before/after" of any UI change. Needs Playwright (npm i -g playwright) and the
// bench running:
//
//   pnpm exec vite build --config vite.preview.config.ts
//   pnpm exec vite preview --config vite.preview.config.ts --port 5199
//   node preview/shoot.mjs http://localhost:5199 ../shots [820x560,1040x720,1440x900]
//
// The optional third argument lists the window sizes; by default the three the
// app has to work at: the minimum (tauri.conf.json), the default and a big one.
// The screens walked are in screens.mjs.
// PW_PATH may point at a Playwright install that is not resolvable from here.
import { createRequire } from "node:module";
import fs from "node:fs";
import { screens } from "./screens.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const [base = "http://localhost:5199", out = "shots", sizeArg = "820x560,1040x720,1440x900"] =
  process.argv.slice(2);
const sizes = sizeArg.split(",").map((s) => s.split("x").map(Number));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];

for (const [width, height] of sizes) {
  for (const theme of ["light", "dark"]) {
    const p = await browser.newPage({ viewport: { width, height }, colorScheme: theme, locale: process.env.MORI_LANG || "it-IT" });
    p.on("pageerror", (e) => errors.push(`${theme} ${width}x${height}: ${e.message}`));
    for await (const name of screens(p, base)) {
      await p.screenshot({ path: `${out}/${theme}-${width}-${name}.png` });
    }
    await p.close();
  }
}

await browser.close();
console.log(errors.length ? errors.join("\n") : `ok: screenshot in ${out}`);
