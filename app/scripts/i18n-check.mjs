// Every t("…") / tn(n, "…", "…") in src has its English in src/i18n/en/*.ts,
// with the same {placeholders}. Fast, no database: run it while translating.
//
//   node scripts/i18n-check.mjs [path-filter]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filter = process.argv[2] ?? "";
const enDir = path.join(appRoot, "src/i18n/en");
const dict = {};
for (const f of fs.readdirSync(enDir).filter((x) => x.endsWith(".ts"))) {
  // The area files are plain object literals: read them as data, not as code.
  const src = fs.readFileSync(path.join(enDir, f), "utf8");
  const body = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  const obj = Function(`"use strict"; return (${body});`)();
  for (const [k, v] of Object.entries(obj)) {
    if (k in dict && dict[k] !== v) console.log(`  doppione con traduzioni diverse (${f}): ${k}`);
    dict[k] = v;
  }
}
const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== "i18n") walk(full); }
    else if (/\.(ts|tsx)$/.test(f.name)) files.push(full);
  }
};
walk(path.join(appRoot, "src"));
const re = /\bt[n]?\(\s*(?:[\w.]+\s*,\s*)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(?:\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?/g;
const ph = (x) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
let seen = 0, bad = 0;
for (const f of files) {
  const rel = path.relative(appRoot, f);
  if (filter && !rel.includes(filter)) continue;
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    for (const lit of [m[1], m[2]].filter(Boolean)) {
      let key;
      try { key = lit.startsWith("'") ? lit.slice(1, -1).replace(/\\'/g, "'") : JSON.parse(lit); } catch { continue; }
      seen++;
      if (!(key in dict)) { bad++; console.log(`  manca  ${rel}: ${key}`); }
      else if (ph(key) !== ph(dict[key])) { bad++; console.log(`  segnaposto diversi  ${rel}: ${key}`); }
    }
  }
}
console.log(bad ? `\n${bad} testi senza inglese (su ${seen})` : `\nTUTTO OK: ${seen} testi, tutti con l'inglese`);
process.exit(bad ? 1 : 0);
