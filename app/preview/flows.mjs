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
  const ctx = await browser.newContext({ viewport: size, locale: process.env.MORI_LANG || "en-US", permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(`${base}/?v=app`);
    await p.waitForSelector(".home-head h1");
    await fn(p);
    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
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
  await flow(`⌘K finds a phrase and opens the transcript at the right spot (${label})`, size, async (p) => {
    await p.keyboard.press("Control+k");
    await p.fill(".cmd-input", "onboarding");
    await p.click(".cmd-hit >> nth=0");
    await p.waitForSelector('h1:has-text("Weekly product sync")');
    await p.waitForSelector(".seg-player, .dialogue");
  });

  await flow(`naming the other speaker (${label})`, size, async (p) => {
    await openCall(p, "Weekly product sync");
    await tab(p, "Transcript");
    await p.fill('input[placeholder^="e.g."]', "Julia Ferris");
    await p.keyboard.press("Enter");
    await p.waitForSelector('.sn-row:has-text("Julia Ferris")');
    await p.waitForSelector('.speaker:has-text("Julia Ferris")');
  });

  await flow(`private call, on and off (${label})`, size, async (p) => {
    await openCall(p, "Annual plan pricing");
    // The privacy switch, wherever it lives: a pressed toggle once private.
    const lock = 'main .sa-private, main [data-action="private"]';
    await p.click(lock);
    await p.waitForSelector('[role="status"]:has-text("Private call")');
    await p.waitForSelector('main .sa-private.on, main [data-action="private"][aria-pressed="true"]');
    await p.click(lock);
    await p.waitForSelector('[role="status"]:has-text("no longer private")');
  });

  await flow(`follow-up written and copied (${label})`, size, async (p) => {
    await openCall(p, "Weekly product sync");
    await p.click('button:has-text("follow-up")');
    await p.waitForSelector('textarea:has-text("Subject:")');
    await p.click('button:has-text("Copy email")');
    await p.waitForSelector('[role="status"]:has-text("Email copied")');
  });

  await flow(`ask Mori, streamed answer, citation that opens the call (${label})`, size, async (p) => {
    await p.click('[data-nav="chat"]');
    const box = p.locator('.composer input, .composer textarea');
    await box.fill("What did we decide about the paywall?");
    await box.press("Enter");
    await p.waitForSelector('.bubble.assistant:last-child :text("From your calls")');
    const cite = p.locator(".bubble.assistant:last-child .md-cite").first();
    await cite.waitFor();
    const title = (await cite.textContent()).split(" — ")[0].trim();
    await cite.click();
    await p.waitForSelector(`h1:has-text("${title}")`);
  });

  await flow(`record, stop, transcribe (${label})`, size, async (p) => {
    await p.click('.sidebar [data-rec="idle"] button');
    await p.waitForSelector('.sidebar [data-rec="recording"]');
    await p.waitForTimeout(1100);
    await p.click('.sidebar [data-rec="recording"] button:has-text("Stop")');
    await p.waitForSelector("text=Transcribing this call");
    await tab(p, "Transcript").catch(() => {});
    await p.waitForSelector("text=Let's try Mori on the preview bench", { timeout: 8000 });
  });
}

await flow("To-dos: arrows and space mark a to-do done", WIDE, async (p) => {
  await p.click('[data-nav="todos"]');
  await p.waitForSelector(".todo-row");
  const first = p.locator(".todo-row").first();
  const text = await first.locator(".todo-txt").textContent();
  await first.focus();
  await p.keyboard.press(" ");
  await p.waitForSelector(`.todos-done-head`);
  if (!text) throw new Error("no row");
});

await flow("call page: delete and Undo, J/K, 1/2/3, Ctrl+J, Esc", WIDE, async (p) => {
  await openCall(p, "Annual plan pricing");
  await p.keyboard.press("2");
  await p.waitForSelector('[role="tab"][aria-selected="true"]:has-text("Transcript")');
  await p.keyboard.press("1");
  await p.waitForSelector('[role="tab"][aria-selected="true"]:has-text("Summary")');
  await p.keyboard.press("Control+j");
  await p.waitForSelector('.chat-panel');
  await p.keyboard.press("Escape");
  await p.waitForSelector('.chat-panel', { state: "detached" });
  await p.keyboard.press("k");
  await p.waitForSelector('h1:has-text("Weekly product sync")');
  await p.keyboard.press("j");
  await p.waitForSelector('h1:has-text("Annual plan pricing")');
  // Delete: gone at once, back with Undo.
  await p.click('button[aria-label="More actions"]');
  await p.click('[role="menuitem"]:has-text("Delete")');
  await p.waitForSelector('.toast.undo:has-text("Call deleted")');
  if (await p.locator('.sidebar .recent-item:has-text("Annual plan pricing")').count()) throw new Error("the deleted call is still in Recents");
  await p.click('.toast.undo button:has-text("Undo")');
  await p.waitForSelector('h1:has-text("Annual plan pricing")');
  await p.waitForSelector('.sidebar .recent-item:has-text("Annual plan pricing")');
  // Esc goes back where the call was opened from.
  await p.keyboard.press("Escape");
  await p.waitForSelector(".home-head h1");
});

await flow("⌘K from the keyboard only: arrows and Enter", WIDE, async (p) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type("what did we decide?");
  await p.waitForSelector('.cmd-row.active:has-text("Ask Mori")');
  await p.fill(".cmd-input", "Pricing");
  await p.waitForSelector('.cmd-row.active:has-text("Annual plan pricing")');
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Enter");
  await p.waitForSelector('h1:has-text("Annual plan pricing")');
  await p.keyboard.press("Control+k");
  await p.keyboard.type("appearance");
  await p.keyboard.press("Enter");
  await p.waitForSelector('.settings-nav-item[aria-current="true"]:has-text("Appearance")');
});

await flow("settings: page, Save bar, Ctrl+S, they stay saved", WIDE, async (p) => {
  await p.keyboard.press("Control+,");
  await p.waitForSelector('h1:has-text("Settings")');
  if (await p.locator(".save-bar").count()) throw new Error("save bar shown without changes");
  await p.fill("#s-names", "Tu, te, io, me, Alex, Alexis");
  await p.waitForSelector(".save-bar");
  await p.keyboard.press("Control+s");
  await p.waitForSelector('[role="status"]:has-text("Settings saved")');
  await p.waitForSelector(".save-bar", { state: "detached" });
  await p.keyboard.press("Control+1");
  await p.keyboard.press("Control+,");
  const v = await p.inputValue("#s-names");
  if (!v.includes("Alexis")) throw new Error("the saved name is gone: " + v);
  // Unsaved changes survive leaving the page.
  await p.fill("#s-names", "Tu, te");
  await p.keyboard.press("Control+1");
  await p.keyboard.press("Control+,");
  await p.waitForSelector(".settings-restored");
  await p.click('.save-bar button:has-text("Cancel")');
  if ((await p.inputValue("#s-names")).trim() === "Tu, te") throw new Error("Undo did not restore");
});

await flow("To-dos: Delete removes, Undo brings it back", WIDE, async (p) => {
  await p.click('[data-nav="todos"]');
  await p.waitForSelector(".todo-row");
  const first = p.locator(".todo-row").first();
  const text = (await first.locator(".todo-txt").textContent()).trim();
  await first.focus();
  await p.keyboard.press("Delete");
  await p.waitForSelector('.toast.undo:has-text("Deleted")');
  if (await p.locator(`.todo-txt:text-is("${text}")`).count()) throw new Error("the deleted row is still there");
  await p.keyboard.press("Control+z");
  await p.waitForSelector(`.todo-txt:text-is("${text}")`);
});

await flow("without Undo, the call is really deleted after 6 seconds", WIDE, async (p) => {
  await openCall(p, "User interview #4");
  await p.click('button[aria-label="More actions"]');
  await p.click('[role="menuitem"]:has-text("Delete")');
  await p.waitForSelector(".toast.undo");
  await p.waitForSelector(".toast.undo", { state: "detached", timeout: 9000 });
  await p.keyboard.press("Control+5");
  await p.waitForSelector(".call-row");
  if (await p.locator('.call-row:has-text("User interview #4")').count()) throw new Error("the call is still there");
});

await flow("paste a transcript: the call is created and opens", WIDE, async (p) => {
  await p.keyboard.press("Control+k");
  await p.keyboard.type("paste");
  await p.keyboard.press("Enter");
  await p.waitForSelector('[role="dialog"]:has-text("Paste a transcript")');
  await p.fill("#add-title", "Pasted bench call");
  await p.fill("#add-text", "Tu: let us try pasting a call.\nJulia: sounds good, it shows up right away.");
  await p.click('[role="dialog"] button:has-text("Add and organize")');
  await p.waitForSelector('h1:has-text("Pasted bench call")');
  await p.waitForSelector('.sidebar .recent-item:has-text("Pasted bench call")');
});

await flow("first run: paste the Groq key, Mori checks it and keeps it", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&fresh=1`);
  await p.waitForSelector(".quick-key");
  await p.fill('.quick-key input', "gsk_bad_key");
  await p.click('.quick-key button[type="submit"]');
  await p.waitForSelector('.quick-key-msg.ko:has-text("Invalid key")');
  await p.fill('.quick-key input', "gsk_good");
  await p.click('.quick-key button[type="submit"]');
  await p.waitForSelector('[role="status"]:has-text("connected to Groq")');
  await p.waitForSelector(".quick-key", { state: "detached" });
});

await flow("Groq refuses the key: transcribes on the PC and says so", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&cloudfail=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForTimeout(1100);
  await p.click('.sidebar [data-rec="recording"] button:has-text("Stop")');
  await p.waitForSelector('.toast.error:has-text("Groq key")', { timeout: 15000 });
});

await flow("the microphone unplugs during the call: the control says so", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&deadmic=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForSelector('.rec-warn:has-text("The microphone stopped")', { timeout: 5000 });
  await p.click('.sidebar [data-rec="recording"] button:has-text("Stop")');
  await p.waitForSelector(".rec-warn", { state: "detached" });
});

await flow("record → transcribe → “Understanding” → “is ready” → Open", WIDE, async (p) => {
  await p.goto(`${base}/?v=app&understand=1&undms=2500`);
  await p.waitForSelector(".home-head h1");
  // A call of the fixtures is understood at startup: its "is ready" goes first.
  await p.waitForSelector(".toast.ready", { timeout: 20000 });
  await p.click(".toast.ready .toast-x");
  await p.click('.sidebar [data-rec="idle"] button');
  await p.waitForSelector('.sidebar [data-rec="recording"]');
  await p.waitForTimeout(1100);
  await p.click('.sidebar [data-rec="recording"] button:has-text("Stop")');
  await p.waitForSelector('.tr-strip:has-text("Transcribing")', { timeout: 8000 });
  await p.waitForSelector('.tr-strip:has-text("Understanding")', { timeout: 15000 });
  await p.waitForSelector(".notice-card .tr-progress");
  // Elsewhere in Mori when it is done: the toast, and Open opens the call.
  await p.click('.sidebar [data-nav="home"]');
  await p.waitForSelector(".toast.ready", { timeout: 15000 });
  await p.click(".toast.ready .btn");
  await p.waitForSelector('h1:has-text("Bench test")');
});

await flow("keyboard: Ctrl+1…5, Ctrl+\\, ? and Esc", WIDE, async (p) => {
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
  await p.waitForSelector('[role="dialog"]:has-text("Keyboard shortcuts")');
  await p.keyboard.press("Escape");
  await p.waitForSelector('[role="dialog"]', { state: "detached" });
});

// "Looks like a call": the suggestion, and the brief picked from it.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: process.env.MORI_LANG || "en-US" });
  const p = await ctx.newPage();
  const name = "\"looks like a call\": Prepare the brief opens the page";
  try {
    await p.goto(`${base}/?v=app&call=1`);
    await p.waitForSelector('.toast.call-detect:has-text("Looks like a call")', { timeout: 12000 });
    await p.click('.toast.call-detect button:has-text("Prepare the brief")');
    await p.waitForSelector(".brief-pick");
    // The veil covers the window: a click far from the list closes it.
    await p.mouse.click(1000, 650);
    await p.waitForSelector(".brief-pick", { state: "detached" });
    await p.click('.toast.call-detect button:has-text("Prepare the brief")');
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

// A new install: the demo calls go with one click, and come back with Undo.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: process.env.MORI_LANG || "en-US" });
  const p = await ctx.newPage();
  const name = "first run: Remove them and Undo";
  try {
    await p.goto(`${base}/?v=app&fresh=1`);
    await p.waitForSelector(".welcome-demo");
    const before = await p.locator(".sidebar .recent-item").count();
    await p.click('.welcome-demo button:has-text("Remove them")');
    await p.waitForSelector('.toast.undo:has-text("sample call")');
    if ((await p.locator(".sidebar .recent-item").count()) !== 0) throw new Error("the sample calls are still in Recents");
    await p.click('.toast.undo button:has-text("Undo")');
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
console.log(failures.length ? `\n${failures.length} flows failed, ${passed} passed` : `\nALL OK: ${passed} flows passed`);
process.exit(failures.length ? 1 : 0);
