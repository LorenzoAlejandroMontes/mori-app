// The main flows, walked end to end on the preview bench with a real browser:
// record → transcribe, ask → cite, private call, follow-up, ⌘K, naming the
// other speaker, plus the keyboard. Run it after every UI change: a flow that
// breaks here would break on the user's PC.
//
//   pnpm exec vite build --config vite.preview.config.ts
//   pnpm exec vite preview --config vite.preview.config.ts --port 5199
//   node preview/flows.mjs http://localhost:5199
//
// PW_PATH may point at a Playwright install that is not resolvable from here.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const [base = "http://localhost:5199"] = process.argv.slice(2);

const browser = await chromium.launch();
const failures = [];
let passed = 0;

async function flow(name, size, fn) {
  const ctx = await browser.newContext({ viewport: size, locale: process.env.MORI_LANG || "it-IT", permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(`${base}/?v=app`);
    await p.waitForSelector(".home-head h1");
    await fn(p);
    if (errors.length) throw new Error("errori nella pagina: " + errors.join(" | "));
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name} — ${String(e.message ?? e).split("\n")[0]}`);
    await p.screenshot({ path: `flow-fail-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
  await ctx.close();
}

const WIDE = { width: 1040, height: 720 };
const SMALL = { width: 820, height: 560 };

async function openCall(p, title) {
  await p.keyboard.press("Control+k");
  await p.fill(".cmd-input", title);
  await p.click(`.cmd-row:has(.cmd-row-main:text-is("${title}")) >> nth=0`);
  await p.waitForSelector(`h1:has-text("${title}")`);
}

async function tab(p, name) {
  await p.click(`[role="tab"]:has-text("${name}"), .tab:has-text("${name}")`);
}

for (const [label, size] of [["1040", WIDE], ["820", SMALL]]) {
  await flow(`⌘K trova una frase e apre il trascritto al punto giusto (${label})`, size, async (p) => {
    await p.keyboard.press("Control+k");
    await p.fill(".cmd-input", "onboarding");
    await p.click(".cmd-hit >> nth=0");
    await p.waitForSelector('h1:has-text("Sync settimanale prodotto")');
    await p.waitForSelector(".seg-player, .dialogue");
  });

  await flow(`nome dell'interlocutore (${label})`, size, async (p) => {
    await openCall(p, "Sync settimanale prodotto");
    await tab(p, "Trascritto");
    await p.fill('input[placeholder="es. Giulia Ferri"]', "Giulia Ferri");
    await p.keyboard.press("Enter");
    await p.waitForSelector('.sn-row:has-text("è Giulia Ferri")');
    await p.waitForSelector('.speaker:has-text("Giulia Ferri")');
  });

  await flow(`call privata, avanti e indietro (${label})`, size, async (p) => {
    await openCall(p, "Pricing del piano annuale");
    // The privacy switch, wherever it lives: a pressed toggle once private.
    const lock = 'main .sa-private, main [data-action="private"]';
    await p.click(lock);
    await p.waitForSelector('[role="status"]:has-text("Call privata")');
    await p.waitForSelector('main .sa-private.on, main [data-action="private"][aria-pressed="true"]');
    await p.click(lock);
    await p.waitForSelector('[role="status"]:has-text("non è più privata")');
  });

  await flow(`follow-up scritto e copiato (${label})`, size, async (p) => {
    await openCall(p, "Sync settimanale prodotto");
    await p.click('button:has-text("follow-up")');
    await p.waitForSelector('textarea:has-text("Oggetto:")');
    await p.click('button:has-text("Copia la mail")');
    await p.waitForSelector('[role="status"]:has-text("Mail copiata")');
  });

  await flow(`chiedi a Mori, risposta in streaming, citazione che apre la call (${label})`, size, async (p) => {
    await p.click('[data-nav="chat"]');
    const box = p.locator('.composer input, .composer textarea');
    await box.fill("Cosa abbiamo deciso sul paywall?");
    await box.press("Enter");
    await p.waitForSelector('.bubble.assistant:last-child :text("Dalle tue call")');
    const cite = p.locator(".bubble.assistant:last-child .md-cite").first();
    await cite.waitFor();
    const title = (await cite.textContent()).split(" — ")[0].trim();
    await cite.click();
    await p.waitForSelector(`h1:has-text("${title}")`);
  });

  await flow(`registra, ferma, trascrive (${label})`, size, async (p) => {
    await p.click('.sidebar [data-rec="idle"] button');
    await p.waitForSelector('.sidebar [data-rec="recording"]');
    await p.waitForTimeout(1100);
    await p.click('.sidebar [data-rec="recording"] button:has-text("Ferma")');
    await p.waitForSelector("text=Sto trascrivendo");
    await tab(p, "Trascritto").catch(() => {});
    await p.waitForSelector('text=Proviamo Mori sul banco di prova', { timeout: 8000 });
  });
}

await flow("Da fare: frecce e spazio segnano una cosa fatta", WIDE, async (p) => {
  await p.click('[data-nav="todos"]');
  await p.waitForSelector(".todo-row");
  const first = p.locator(".todo-row").first();
  const text = await first.locator(".todo-txt").textContent();
  await first.focus();
  await p.keyboard.press(" ");
  await p.waitForSelector(`.todos-done-head`);
  if (!text) throw new Error("nessuna riga");
});

await flow("pagina della call: elimina e Annulla, J/K, 1/2/3, Ctrl+J, Esc", WIDE, async (p) => {
  await openCall(p, "Pricing del piano annuale");
  await p.keyboard.press("2");
  await p.waitForSelector('[role="tab"][aria-selected="true"]:has-text("Trascritto")');
  await p.keyboard.press("1");
  await p.waitForSelector('[role="tab"][aria-selected="true"]:has-text("Sintesi")');
  await p.keyboard.press("Control+j");
  await p.waitForSelector('.chat-panel');
  await p.keyboard.press("Escape");
  await p.waitForSelector('.chat-panel', { state: "detached" });
  await p.keyboard.press("k");
  await p.waitForSelector('h1:has-text("Sync settimanale prodotto")');
  await p.keyboard.press("j");
  await p.waitForSelector('h1:has-text("Pricing del piano annuale")');
  // Delete: gone at once, back with Annulla.
  await p.click('button[aria-label="Altre azioni"]');
  await p.click('[role="menuitem"]:has-text("Elimina")');
  await p.waitForSelector('.toast.undo:has-text("Call eliminata")');
  if (await p.locator('.sidebar .recent-item:has-text("Pricing del piano annuale")').count()) throw new Error("la call eliminata è ancora nei Recenti");
  await p.click('.toast.undo button:has-text("Annulla")');
  await p.waitForSelector('h1:has-text("Pricing del piano annuale")');
  await p.waitForSelector('.sidebar .recent-item:has-text("Pricing del piano annuale")');
  // Esc goes back where the call was opened from.
  await p.keyboard.press("Escape");
  await p.waitForSelector(".home-head h1");
});

await flow("⌘K solo da tastiera: frecce e Invio", WIDE, async (p) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type("cosa abbiamo deciso?");
  await p.waitForSelector('.cmd-row.active:has-text("Chiedi a Mori")');
  await p.fill(".cmd-input", "Pricing");
  await p.waitForSelector('.cmd-row.active:has-text("Pricing del piano annuale")');
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Enter");
  await p.waitForSelector('h1:has-text("Pricing del piano annuale")');
  await p.keyboard.press("Control+k");
  await p.keyboard.type("aspetto");
  await p.keyboard.press("Enter");
  await p.waitForSelector('.settings-nav-item[aria-current="true"]:has-text("Aspetto")');
});

await flow("impostazioni: pagina, barra Salva, Ctrl+S, restano salvate", WIDE, async (p) => {
  await p.keyboard.press("Control+,");
  await p.waitForSelector('h1:has-text("Impostazioni")');
  if (await p.locator(".save-bar").count()) throw new Error("barra di salvataggio senza modifiche");
  await p.fill("#s-names", "Tu, te, io, me, Luca, Lucas");
  await p.waitForSelector(".save-bar");
  await p.keyboard.press("Control+s");
  await p.waitForSelector('[role="status"]:has-text("Impostazioni salvate")');
  await p.waitForSelector(".save-bar", { state: "detached" });
  await p.keyboard.press("Control+1");
  await p.keyboard.press("Control+,");
  const v = await p.inputValue("#s-names");
  if (!v.includes("Lucas")) throw new Error("il nome salvato non c'è più: " + v);
  // Unsaved changes survive leaving the page.
  await p.fill("#s-names", "Tu, te");
  await p.keyboard.press("Control+1");
  await p.keyboard.press("Control+,");
  await p.waitForSelector(".settings-restored");
  await p.click('.save-bar button:has-text("Annulla")');
  if ((await p.inputValue("#s-names")).trim() === "Tu, te") throw new Error("Annulla non ha ripristinato");
});

await flow("Da fare: Canc elimina, Annulla la riporta", WIDE, async (p) => {
  await p.click('[data-nav="todos"]');
  await p.waitForSelector(".todo-row");
  const first = p.locator(".todo-row").first();
  const text = (await first.locator(".todo-txt").textContent()).trim();
  await first.focus();
  await p.keyboard.press("Delete");
  await p.waitForSelector('.toast.undo:has-text("Eliminata")');
  if (await p.locator(`.todo-txt:text-is("${text}")`).count()) throw new Error("la riga eliminata è ancora lì");
  await p.keyboard.press("Control+z");
  await p.waitForSelector(`.todo-txt:text-is("${text}")`);
});

await flow("senza Annulla, la call si elimina davvero dopo 6 secondi", WIDE, async (p) => {
  await openCall(p, "Intervista utente #4");
  await p.click('button[aria-label="Altre azioni"]');
  await p.click('[role="menuitem"]:has-text("Elimina")');
  await p.waitForSelector(".toast.undo");
  await p.waitForSelector(".toast.undo", { state: "detached", timeout: 9000 });
  await p.keyboard.press("Control+5");
  await p.waitForSelector(".call-row");
  if (await p.locator('.call-row:has-text("Intervista utente #4")').count()) throw new Error("la call c'è ancora");
});

await flow("incolla un trascritto: la call nasce e si apre", WIDE, async (p) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type("incolla");
  await p.keyboard.press("Enter");
  await p.waitForSelector('[role="dialog"]:has-text("Incolla un trascritto")');
  await p.fill("#add-title", "Prova dal banco");
  await p.fill("#add-text", "Tu: proviamo a incollare una call.\nGiulia: va bene, si vede subito.");
  await p.click('[role="dialog"] button:has-text("Aggiungi e organizza")');
  await p.waitForSelector('h1:has-text("Prova dal banco")');
  await p.waitForSelector('.sidebar .recent-item:has-text("Prova dal banco")');
});

await flow("prima apertura: incolla la chiave Groq, Mori la verifica e la tiene", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&fresh=1`);
  await p.waitForSelector(".quick-key");
  await p.fill('.quick-key input', "gsk_bad_key");
  await p.click('.quick-key button[type="submit"]');
  await p.waitForSelector('.quick-key-msg.ko:has-text("Chiave non valida")');
  await p.fill('.quick-key input', "gsk_buona");
  await p.click('.quick-key button[type="submit"]');
  await p.waitForSelector('[role="status"]:has-text("collegato a Groq")');
  await p.waitForSelector(".quick-key", { state: "detached" });
});

await flow("Groq rifiuta la chiave: trascrive sul PC e lo dice", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&cloudfail=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForTimeout(1100);
  await p.click('.sidebar [data-rec="recording"] button:has-text("Ferma")');
  await p.waitForSelector('.toast.error:has-text("chiave Groq non è valida")', { timeout: 15000 });
});

await flow("il microfono si stacca durante la call: lo dice nel controllo", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&deadmic=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForSelector('.rec-warn:has-text("Il microfono si è fermato")', { timeout: 5000 });
  await p.click('.sidebar [data-rec="recording"] button:has-text("Ferma")');
  await p.waitForSelector(".rec-warn", { state: "detached" });
});

await flow("registra → trascrive → «Capisco» → «è pronta» → Apri", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&understand=1&undms=2500`);
  await p.waitForSelector(".home-head h1");
  // A call of the fixtures is understood at startup: its "è pronta" goes first.
  await p.waitForSelector(".toast.ready", { timeout: 20000 });
  await p.click(".toast.ready .toast-x");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForTimeout(1100);
  await p.click('.sidebar [data-rec="recording"] button:has-text("Ferma")');
  await p.waitForSelector('.tr-strip:has-text("Trascrivo")', { timeout: 8000 });
  await p.waitForSelector('.tr-strip:has-text("Capisco")', { timeout: 15000 });
  await p.waitForSelector(".notice-card .tr-progress");
  // Elsewhere in Mori when it is done: the toast, and Apri opens the call.
  await p.click('.sidebar [data-nav="home"]');
  await p.waitForSelector(".toast.ready", { timeout: 15000 });
  await p.click(".toast.ready .btn");
  await p.waitForSelector('h1:has-text("Prova sul banco")');
});

await flow("tastiera: Ctrl+1…5, Ctrl+\\, ? e Esc", WIDE, async (p) => {
  await p.keyboard.press("Control+3");
  await p.waitForSelector('[data-nav="todos"][aria-current="page"]');
  await p.keyboard.press("Control+5");
  await p.waitForSelector('[data-nav="history"][aria-current="page"]');
  await p.keyboard.press("Control+1");
  await p.waitForSelector('[data-nav="home"][aria-current="page"]');
  await p.keyboard.press("Control+\\");
  await p.waitForSelector(".mini-rail");
  await p.keyboard.press("Control+\\");
  await p.waitForSelector(".sidebar");
  await p.keyboard.press("Shift+?");
  await p.waitForSelector('[role="dialog"]:has-text("Scorciatoie da tastiera")');
  await p.keyboard.press("Escape");
  await p.waitForSelector('[role="dialog"]', { state: "detached" });
});

// "Sembra una call": the suggestion, and the brief picked from it.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: process.env.MORI_LANG || "it-IT" });
  const p = await ctx.newPage();
  const name = "\"sembra una call\": Prepara il brief apre la scheda";
  try {
    await p.goto(`${base}/?v=app&call=1`);
    await p.waitForSelector('.toast.call-detect:has-text("Sembra una call")', { timeout: 12000 });
    await p.click('.toast.call-detect button:has-text("Prepara il brief")');
    await p.waitForSelector(".brief-pick");
    // The veil covers the window: a click far from the list closes it.
    await p.mouse.click(1000, 650);
    await p.waitForSelector(".brief-pick", { state: "detached" });
    await p.click('.toast.call-detect button:has-text("Prepara il brief")');
    await p.click('.brief-pick .merge-row >> nth=0');
    await p.waitForSelector(".person-head");
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name} — ${String(e.message ?? e).split("\n")[0]}`);
  }
  await ctx.close();
}

// A new install: the demo calls go with one click, and come back with Annulla.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: process.env.MORI_LANG || "it-IT" });
  const p = await ctx.newPage();
  const name = "prima apertura: Toglile e Annulla";
  try {
    await p.goto(`${base}/?v=app&fresh=1`);
    await p.waitForSelector(".welcome-demo");
    const before = await p.locator(".sidebar .recent-item").count();
    await p.click('.welcome-demo button:has-text("Toglile")');
    await p.waitForSelector('.toast.undo:has-text("call di esempio")');
    if ((await p.locator(".sidebar .recent-item").count()) !== 0) throw new Error("le call di esempio sono ancora nei Recenti");
    await p.click('.toast.undo button:has-text("Annulla")');
    await p.waitForFunction((n) => document.querySelectorAll(".sidebar .recent-item").length === n, before);
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name} — ${String(e.message ?? e).split("\n")[0]}`);
  }
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} flussi falliti, ${passed} passati` : `\nTUTTO OK: ${passed} flussi passati`);
process.exit(failures.length ? 1 : 0);
