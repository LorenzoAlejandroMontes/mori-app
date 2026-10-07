// Accessibility audit of every main screen, light and dark, with axe-core (the
// WCAG 2.1 AA rules: contrast, names of buttons and fields, roles…). Same walk
// as the screenshots (screens.mjs). Fails when anything is found.
//
//   node preview/audit.mjs http://localhost:5199 [--all]
//
// Every problem is counted; the listing shows four elements per rule, all of
// them with --all.
import { createRequire } from "node:module";
import { screens } from "./screens.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const axeSource = require("fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base = "http://localhost:5199"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");

const browser = await chromium.launch();
let total = 0;

for (const theme of ["light", "dark"]) {
  const p = await browser.newPage({ viewport: { width: 1040, height: 720 }, colorScheme: theme, locale: process.env.MORI_LANG || "it-IT" });
  for await (const name of screens(p, base)) {
    await p.addScriptTag({ content: axeSource });
    const res = await p.evaluate(async () => {
      // @ts-ignore axe is injected above
      const r = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
      });
      return r.violations.map((v) => ({
        id: v.id,
        help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(1, 2).join(" ") })),
      }));
    });
    const n = res.reduce((s, v) => s + v.nodes.length, 0);
    total += n;
    console.log(`${n ? "  FAIL" : "  ok  "} ${theme} ${name}${n ? ` — ${n} problemi` : ""}`);
    for (const v of res) {
      console.log(`         ${v.id}: ${v.help} (${v.nodes.length})`);
      for (const node of v.nodes.slice(0, all ? 50 : 4)) console.log(`           ${node.target}  ${node.summary ?? ""}`);
    }
  }
  await p.close();
}

await browser.close();
console.log(total ? `\n${total} problemi di accessibilità` : "\nTUTTO OK: nessun problema WCAG 2.1 AA trovato");
process.exit(total ? 1 : 0);
