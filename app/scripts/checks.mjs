// Runnable checks for the logic a green build cannot prove: the job state
// machine, due-date resolution, the recall context budget, vocabulary
// replacement and the follow-up retrieval query.
//
// Runs Mori's REAL modules (src/jobs.ts, src/organize.ts, …) under node, with
// the Tauri APIs replaced by the doubles in _stubs.mjs and a throwaway SQLite
// file built from the real migrations. It NEVER touches ~/.mori/mori.db.
//
//   node scripts/checks.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { DatabaseSync } from "node:sqlite";
import * as stubs from "./_stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
// The doubles are handed to the module graph through a global: a virtual module
// cannot import a file:// URL out of vite's SSR graph on Windows paths.
globalThis.__moriStubs = stubs;

// --- tiny test harness -------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}
function section(t) {
  console.log(`\n${t}`);
}

// --- a throwaway DB with the real schema ------------------------------------
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mori-check-"));
  const file = path.join(dir, "check.db");
  const db = new DatabaseSync(file);
  const migDir = path.join(appRoot, "src-tauri", "migrations");
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  }
  db.close();
  return file;
}

// --- module loading ----------------------------------------------------------
const ALIASES = {
  "@tauri-apps/plugin-sql": `export default globalThis.__moriStubs.FakeDatabase;`,
  "@tauri-apps/api/core": `export const invoke = (...a) => globalThis.__moriStubs.invoke(...a);
export const convertFileSrc = (...a) => globalThis.__moriStubs.convertFileSrc(...a);`,
  "@tauri-apps/plugin-http": `export const fetch = (...a) => globalThis.__moriStubs.fetch(...a);`,
};

async function loadModules(names) {
  const server = await createServer({
    configFile: false,
    root: appRoot,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, watch: null },
    // Without this vite would externalize the real @tauri-apps packages to node
    // instead of letting the stub plugin answer for them.
    ssr: { noExternal: [/^@tauri-apps\//] },
    plugins: [
      {
        name: "mori-tauri-stubs",
        enforce: "pre",
        resolveId: (id) => (ALIASES[id] ? "\0stub:" + id : null),
        load: (id) => (id.startsWith("\0stub:") ? ALIASES[id.slice(6)] : null),
      },
    ],
  });
  const out = {};
  for (const n of names) out[n] = await server.ssrLoadModule(`/src/${n}.ts`);
  return { mods: out, close: () => server.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  stubs.installGlobals();
  const dbFile = freshDb();
  stubs.invokeHandlers.set("get_db_url", () => `sqlite:${dbFile}`);
  stubs.invokeHandlers.set("embed_texts", () => "[]");

  const { mods, close } = await loadModules([
    "jobs",
    "organize",
    "recall",
    "vocab",
    "chatStore",
    "llm",
    "db",
    "index",
    "export-logic",
    "companion-logic",
    "ui/markdown-logic",
    "views/home-logic",
    "views/todo-logic",
    "search-logic",
    "speakers-logic",
    "brief",
    "progress-logic",
    "i18n/index",
    "i18n/en",
    "recorder",
    "recording-logic",
    "ui/platform",
    "ui/keys",
    "setup-logic",
  ]);
  // Node on a Mac says it is a Mac: the checks below assert the Windows
  // wording, wherever they run. Section 28 asks for both.
  mods["ui/platform"].usePlatformNow(false);
  // The modules speak the language of the machine (Node's navigator says
  // en-US): the checks below assert the Italian, so Italian it is.
  mods["i18n/index"].useLangNow("it");
  const { jobs, organize, recall, vocab, chatStore, llm, db } = mods;
  const d = await db.db();

  // A provider key, so organize jobs are not parked waiting for one.
  await llm.saveConfig({ baseUrl: "http://stub/v1", apiKey: "k", model: "m" });

  const nowIso = () => new Date().toISOString();
  async function makeSession(id, title, memo, provider = "recording") {
    await d.execute(
      `INSERT INTO session (id, title, kind, status, folder_path, language, started_at, ended_at, metadata_json, sensitive, created_at, updated_at)
       VALUES ($1, $2, 'meeting', 'done', '/', 'it', $3, $3, '{}', 0, $3, $3)`,
      [id, title, nowIso()],
    );
    if (memo !== null) {
      await d.execute(
        `INSERT INTO session_transcript (id, session_id, memo, provider, model, created_at)
         VALUES ($1, $2, $3, $4, 'whisper', $5)`,
        [id + "-t", id, memo, provider, nowIso()],
      );
    }
  }

  // =========================================================================
  section("1 · coda dei lavori");

  await makeSession("j1", "Call di prova", "Trascritto finto di una call di prova.");

  await jobs.enqueueJob("organize", "j1", {});
  await jobs.enqueueJob("organize", "j1", {});
  const [{ n: nJobs }] = await d.select(`SELECT COUNT(*) n FROM job WHERE session_id = 'j1'`);
  eq("doppio enqueue = un solo lavoro", nJobs, 1);

  // The LLM refuses three times → three attempts, then 'failed' with the error kept.
  for (let i = 0; i < 6; i++) stubs.httpReplies.push({ status: 500, body: "boom" });
  await jobs.pumpJobs();
  let [j] = await d.select(`SELECT * FROM job WHERE session_id = 'j1'`);
  eq("primo errore → torna in coda", j.status, "pending");
  eq("tentativo contato", j.attempts, 1);
  check("errore salvato", /500/.test(j.last_error ?? ""), j.last_error ?? "(nessuno)");
  check("backoff programmato", (j.next_at ?? "") > nowIso(), j.next_at ?? "(nessuno)");

  // Backoff honoured: a pump before next_at must not touch the job.
  await jobs.pumpJobs();
  [j] = await d.select(`SELECT attempts FROM job WHERE session_id = 'j1'`);
  eq("il backoff blocca il ritentativo", j.attempts, 1);

  for (let i = 0; i < 2; i++) {
    await d.execute(`UPDATE job SET next_at = $1 WHERE session_id = 'j1'`, ["2000-01-01T00:00:00Z"]);
    await jobs.pumpJobs();
  }
  [j] = await d.select(`SELECT * FROM job WHERE session_id = 'j1'`);
  eq("dopo 3 tentativi → fallito", j.status, "failed");
  eq("tentativi", j.attempts, 3);

  const st = await jobs.jobsBySession();
  eq("la UI vede il fallimento", st["j1"]?.status, "failed");
  check("etichetta in italiano", /non è riuscita/.test(jobs.jobLabel(st["j1"])), jobs.jobLabel(st["j1"]));

  // "Riprova" clears the failure and runs it again — this time the LLM answers.
  stubs.httpReplies.length = 0;
  stubs.httpReplies.push(
    JSON.stringify({
      title: "Prova riuscita",
      summary: "## Di cosa si è parlato\n- prova",
      actions: [{ text: "Mandare il preventivo", assignee: "Lorenzo", due: "giovedì" }],
      categories: [{ name: "Prodotto", kind: "theme" }],
      memories: [{ content: "Prova fatta", kind: "fact", subject_type: "general", subject_id: null }],
      entities: [{ kind: "person", name: "Alenso" }],
      commitments: [],
      decisions: [],
    }),
  );
  await jobs.retrySession("j1");
  [j] = await d.select(`SELECT status, attempts FROM job WHERE session_id = 'j1'`);
  eq("Riprova → riuscito", j.status, "done");
  const [{ n: nSum }] = await d.select(
    `SELECT COUNT(*) n FROM session_document WHERE session_id = 'j1' AND kind = 'summary'`,
  );
  eq("sintesi scritta", nSum, 1);

  // A job that dies with the app is resumed, and a raw call is recovered.
  await makeSession("j2", "Call mai organizzata", "Un'altra trascrizione reale.");
  // Crashed mid-job = 'running' with a heartbeat that stopped long ago.
  await d.execute(`UPDATE job SET status = 'running', updated_at = '2000-01-01T00:00:00Z' WHERE session_id = 'j1'`);
  // Another window working right now = 'running' with a FRESH heartbeat.
  await makeSession("j9", "In corso altrove", "Trascritto.");
  await d.execute(
    `INSERT INTO job (id, session_id, kind, status, attempts, payload_json, created_at, updated_at)
     VALUES ('job9', 'j9', 'organize', 'running', 1, '{}', $1, $1)`,
    [nowIso()],
  );
  stubs.httpReplies.push({ status: 500, body: "x" }, { status: 500, body: "x" });
  await jobs.resumeJobs();
  const [alive] = await d.select(`SELECT status FROM job WHERE id = 'job9'`);
  eq("un lavoro vivo in un'altra finestra non viene rubato", alive.status, "running");
  const recovered = await d.select(`SELECT session_id, kind FROM job WHERE session_id = 'j2'`);
  check(
    "call grezza recuperata (organize in coda)",
    recovered.some((r) => r.kind === "organize"),
    JSON.stringify(recovered),
  );
  const [{ n: seedJobs }] = await d.select(
    `SELECT COUNT(*) n FROM job j JOIN session_transcript t ON t.session_id = j.session_id WHERE t.provider = 'seed' AND j.kind = 'organize'`,
  );
  eq("le call di esempio non vengono organizzate", seedJobs, 0);

  // A missing provider key parks the job instead of burning its attempts — and
  // must NOT stop the work queued behind it (an organize waiting for a key used
  // to block every later transcription forever).
  await llm.saveConfig({ baseUrl: "http://stub/v1", apiKey: "", model: "m" });
  await makeSession("j3", "Senza chiave", "Trascritto.");
  await jobs.enqueueJob("organize", "j3", {});
  await makeSession("j7", "Registrazione dopo", null);
  await jobs.enqueueJob("transcribe", "j7", { wav: "C:\\tmp\\rec.wav", model: "medium", vocab: "" });
  let transcribed = false;
  stubs.invokeHandlers.set("transcribe_file", () => {
    transcribed = true;
    return JSON.stringify({
      audio_path: null,
      result: { text: "Testo trascritto di prova.", language: "it", segments: [] },
    });
  });
  await jobs.pumpJobs();
  const [j3row] = await d.select(`SELECT status, attempts FROM job WHERE session_id = 'j3'`);
  eq("senza chiave resta in coda", j3row.status, "pending");
  eq("senza chiave non consuma tentativi", j3row.attempts, 0);
  check("il lavoro dietro a uno in pausa parte lo stesso", transcribed);
  const [j7row] = await d.select(`SELECT status FROM job WHERE session_id = 'j7' AND kind = 'transcribe'`);
  eq("la trascrizione è andata a buon fine", j7row.status, "done");

  // A transcription that gives up must stop looking like one in progress.
  await makeSession("j8", "Trascrizione persa", null);
  await d.execute(`UPDATE session SET status = 'transcribing' WHERE id = 'j8'`);
  await jobs.enqueueJob("transcribe", "j8", { wav: "C:\\tmp\\sparito.wav" });
  stubs.invokeHandlers.set("transcribe_file", () => {
    throw new Error("audio non trovato: C:\\tmp\\sparito.wav");
  });
  for (let i = 0; i < 3; i++) {
    await d.execute(`UPDATE job SET next_at = '2000-01-01T00:00:00Z' WHERE session_id = 'j8'`);
    await jobs.pumpJobs();
  }
  const [j8job] = await d.select(`SELECT status FROM job WHERE session_id = 'j8'`);
  const [j8ses] = await d.select(`SELECT status FROM session WHERE id = 'j8'`);
  eq("il lavoro è fallito", j8job.status, "failed");
  eq("la call non resta 'in trascrizione'", j8ses.status, "failed");

  await llm.saveConfig({ baseUrl: "http://stub/v1", apiKey: "k", model: "m" });

  // =========================================================================
  section("2 · scadenze relative → date vere");
  const base = "2026-09-14T08:49:40Z"; // lunedì 14 settembre 2026
  const R = organize.resolveDue;
  eq("domani", R("domani", base), "2026-09-15");
  eq("dopodomani", R("dopodomani", base), "2026-09-16");
  eq("oggi", R("oggi", base), "2026-09-14");
  eq("giovedì", R("giovedì", base), "2026-09-17");
  eq("entro venerdì", R("entro venerdì", base), "2026-09-18");
  eq("lunedì (prossimo, non oggi)", R("lunedì", base), "2026-09-21");
  eq("prossima settimana", R("prossima settimana", base), "2026-09-21");
  eq("tra 3 giorni", R("tra 3 giorni", base), "2026-09-17");
  eq("fine mese", R("fine mese", base), "2026-09-30");
  eq("ISO già risolta", R("2026-10-02", base), "2026-10-02");
  eq("ISO con orario", R("2026-10-02T17:00:00Z", base), "2026-10-02");
  eq("data scritta", R("il 2 ottobre", base), "2026-10-02");
  eq("niente", R(null, base), null);
  eq("frase non risolvibile resta com'è", R("quando torna dalle ferie", base), "quando torna dalle ferie");
  eq("anno palesemente sbagliato scartato", R("2024-09-08", base), "2024-09-08");

  section("2b · tetto delle azioni in base alla durata");
  eq("call corta", organize.actionCap(8), 5);
  eq("call da 45 minuti", organize.actionCap(45), 15);
  eq("call da 90 minuti", organize.actionCap(90), 25);
  eq("call lunghissima (tetto)", organize.actionCap(600), 25);

  section("2c · deduplica azioni");
  eq(
    "stessa azione con punteggiatura diversa",
    organize.normalizeText("Mandare il preventivo a Marco!"),
    organize.normalizeText("mandare il  preventivo a marco"),
  );
  check(
    "azioni diverse restano diverse",
    organize.normalizeText("Mandare il preventivo") !== organize.normalizeText("Mandare il contratto"),
  );

  // =========================================================================
  section("3 · dizionario dei nomi");
  await vocab.addTerm({ wrong: "Fondazione Aurola", correct: "Fondazione Aurora", kind: "org" });
  await vocab.addTerm({ wrong: "Alenso", correct: "Lorenzo", kind: "person" });
  await vocab.addTerm({ wrong: "", correct: "ZeroMail", kind: "project" });
  await vocab.reload();
  eq(
    "sostituzione nel trascritto",
    vocab.applyVocab("Ieri Alenso ha visto Fondazione Aurola."),
    "Ieri Lorenzo ha visto Fondazione Aurora.",
  );
  eq("maiuscole/minuscole", vocab.applyVocab("parlo con alenso domani"), "parlo con Lorenzo domani");
  eq("solo parole intere", vocab.applyVocab("Alensone non è Alenso"), "Alensone non è Lorenzo");
  eq("niente da correggere", vocab.applyVocab("Testo pulito."), "Testo pulito.");
  eq("nome canonico corretto", vocab.fixName(" alenso "), "Lorenzo");
  check("i nomi canonici alimentano Whisper", (await vocab.canonicalNames()).includes("ZeroMail"));

  // The dictionary is applied WHEN organize writes, not afterwards. Section 1 ran
  // before the dictionary existed, so drop what it wrote and organize again.
  await d.execute(`DELETE FROM entity`);
  await makeSession("j4", "Call con nomi storti", "Trascritto con nomi storti.");
  stubs.httpReplies.push(
    JSON.stringify({
      title: "Nomi storti",
      summary: "## Di cosa si è parlato\n- nomi",
      actions: [],
      categories: [],
      memories: [],
      entities: [
        { kind: "person", name: "Alenso" },
        { kind: "org", name: "Fondazione Aurola" },
      ],
      commitments: [],
      decisions: [],
    }),
  );
  await jobs.enqueueJob("organize", "j4", {});
  await jobs.pumpJobs();
  const written = (await d.select(`SELECT kind, name FROM entity ORDER BY name`)).map((r) => r.name);
  check("entità corretta già in scrittura", written.join("|") === "Fondazione Aurora|Lorenzo", written.join("|"));

  // Explicit, counted, user-triggered rewrite of existing rows.
  await d.execute(`INSERT INTO entity (id, kind, name, created_at) VALUES ('e-old', 'org', 'Fondazione Aurola', $1)`, [nowIso()]);
  await d.execute(`INSERT INTO session_participant (id, session_id, display_name) VALUES ('p-old', 'j1', 'Alenso')`);
  const preview = await vocab.previewApplyToExisting();
  eq("l'anteprima conta le righe", preview.total, 2);
  const applied = await vocab.applyToExisting();
  eq("applicate esattamente quelle", applied.total, 2);
  const [{ n: leftover }] = await d.select(
    `SELECT COUNT(*) n FROM entity WHERE name = 'Fondazione Aurola'`,
  );
  eq("nome sbagliato sparito", leftover, 0);

  // =========================================================================
  section("4 · budget del contesto di richiamo");
  const P = recall.packBlocks;
  const big = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i} ${"x".repeat(200)}`).join("\n");
  const packed = P(
    [
      { kind: "facts", text: big(20, "F"), budget: 1500 },
      { kind: "todos", text: big(60, "T"), budget: 2500 },
      { kind: "memories", text: big(20, "M"), budget: 1200 },
      { kind: "chunks", text: big(100, "C"), budget: Infinity },
    ],
    12000,
  );
  check("sta nel tetto", packed.length <= 12000, `${packed.length}`);
  check("i fatti ci sono", packed.includes("F0"));
  check("le cose da fare ci sono", packed.includes("T0"));
  check("la memoria c'è (era quella tagliata)", packed.includes("M0"));
  check("i chunk ci sono", packed.includes("C0"));
  check("ogni blocco resta nel suo budget", packed.split("\n").filter((l) => l.startsWith("T")).length <= 13);

  section("4b · priorità alle cose da fare");
  check("domanda sulle cose da fare", recall.isTodoQuestion("cosa devo fare questa settimana?"));
  check("altra domanda sulle scadenze", recall.isTodoQuestion("quali sono le scadenze aperte?"));
  check("domanda normale", !recall.isTodoQuestion("quanto budget ha confermato Marco?"));

  section("4c · le cose da fare scritte a mano arrivano a Mori");
  await makeSession("td1", "Call con Andrew", null);
  await d.execute(
    `INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at)
     VALUES ('ai-td1', 'td1', 'Mandare il preventivo ad Andrew', 'Lorenzo', 'open', NULL, $1)`,
    [nowIso()],
  );
  await d.execute(
    `INSERT INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
     VALUES ('ct-1', 'Rinnovare il dominio', NULL, 'open', NULL, $1, $1),
            ('ct-2', 'Cosa gia chiusa a mano', NULL, 'done', NULL, $1, $1)`,
    [nowIso()],
  );
  const rt = await recall.retrieve("cosa devo fare?");
  check("quella della call c'è, con la call", rt.context.includes("Mandare il preventivo ad Andrew") && rt.context.includes(", da: Call con Andrew"));
  check("quella scritta a mano c'è, come tua", /- Rinnovare il dominio, aggiunta da te/.test(rt.context));
  check("quella chiusa a mano no", !rt.context.includes("Cosa gia chiusa a mano"));

  // =========================================================================
  section("5 · chat con memoria");
  const Q = chatStore.buildRetrievalQuery;
  eq("domanda di seguito corta", Q("e poi?", "cosa ha detto Andrew sul sito?"), "cosa ha detto Andrew sul sito? e poi?");
  eq("prima domanda", Q("cosa ha detto Andrew?", null), "cosa ha detto Andrew?");
  eq(
    "domanda breve ma autonoma non viene contaminata",
    Q("cosa devo fare oggi?", "cosa ha detto Andrew sul sito?"),
    "cosa devo fare oggi?",
  );
  eq(
    "domanda nuova e completa",
    Q("quanto budget ha confermato Marco per il terzo trimestre?", "cosa ha detto Andrew?"),
    "quanto budget ha confermato Marco per il terzo trimestre?",
  );

  const th = await chatStore.newThread();
  await chatStore.appendMessage(th, "user", "prima domanda", null);
  await chatStore.appendMessage(th, "assistant", "prima risposta", [{ id: "j1", title: "x", date: "y" }]);
  const last = await chatStore.loadLastThread();
  eq("il thread si riapre", last.id, th);
  eq("con i suoi turni", last.turns.length, 2);
  eq("e con le fonti", last.turns[1].sources?.[0]?.id, "j1");
  const hist = chatStore.recentHistory(last.turns, 6);
  eq("la storia va al modello", hist.length, 2);

  // =========================================================================
  section("6 · copie del database e audio compresso");
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "mori-bk-"));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "mori-bk2-"));
  const rotated = [];
  const copied = [];
  const deleted = [];
  stubs.invokeHandlers.set("backups_dir", () => backupDir);
  stubs.invokeHandlers.set("rotate_backups", ({ keep }) => {
    rotated.push(keep);
    return [];
  });
  stubs.invokeHandlers.set("copy_into", ({ src, dir }) => {
    copied.push([src, dir]);
    return path.join(dir, path.basename(src));
  });
  stubs.invokeHandlers.set("delete_file", ({ path: p }) => {
    deleted.push(p);
    return null;
  });
  stubs.invokeHandlers.set("audio_stats", () => ({
    wav_count: 1,
    wav_bytes: 30000000,
    flac_count: 0,
    flac_bytes: 0,
  }));

  const { mods: m3, close: close3 } = await loadModules(["backup"]);
  const backup = m3.backup;
  await backup.setSecondFolder(secondDir);
  const r = await backup.runBackup();
  check("la copia esiste", fs.existsSync(r.path), r.path);
  eq("con tutte le call", r.sessions, (await d.select(`SELECT COUNT(*) n FROM session`))[0].n);
  check("rotazione chiesta dopo la verifica", rotated[0] === 7, JSON.stringify(rotated));
  check("copiata nella seconda cartella", copied.length === 1, JSON.stringify(copied));
  check("una copia buona non viene cancellata", deleted.length === 0, JSON.stringify(deleted));

  const first = await backup.getLastBackupAt();
  eq("niente seconda copia entro 24 ore", await backup.maybeBackup(), null);
  eq("la data dell'ultima copia resta", await backup.getLastBackupAt(), first);

  // Compressing a session's audio points the call at the FLAC.
  await d.execute(`UPDATE session SET audio_path = 'C:\\x\\1.wav' WHERE id = 'j1'`);
  stubs.invokeHandlers.set("compress_audio", ({ wav }) => wav.replace(/\.wav$/i, ".flac"));
  const c = await backup.compressAllAudio();
  eq("un audio compresso", c.done, 1);
  const [after] = await d.select(`SELECT audio_path FROM session WHERE id = 'j1'`);
  eq("la call punta al FLAC", after.audio_path, "C:\\x\\1.flac");
  await close3();

  await privacyAndNewChecks({ mods, d, makeSession });
  await progressAndLanguageChecks({ mods });
  await speedAndAudioChecks({ mods, d, makeSession });
  await understandingChecks({ mods, d, makeSession });
  await fallbackChecks({ mods, d, makeSession });
  liveChannelChecks({ mods });
  platformChecks({ mods });
  englishChecks({ mods });
  dashChecks();
  setupChecks({ mods });

  // =========================================================================
  // Optional: run the real recall against a COPY of a real database, to prove the
  // SQL matches the live schema and to measure what the context now contains.
  //   MORI_CHECK_DB=<path to a COPY> node scripts/checks.mjs
  const realCopy = process.env.MORI_CHECK_DB;
  if (realCopy) {
    section("X · richiamo su una copia del database reale");
    const copyDb = new DatabaseSync(realCopy);
    try {
      copyDb.exec(fs.readFileSync(path.join(appRoot, "src-tauri/migrations/0007_reliability.sql"), "utf8"));
    } catch {
      /* already applied */
    }
    // 0008 is all IF NOT EXISTS; then one hand-written to-do, so the block has to
    // carry both sources (the copy is thrown away, the real DB is never opened).
    copyDb.exec(fs.readFileSync(path.join(appRoot, "src-tauri/migrations/0008_companion.sql"), "utf8"));
    const handTs = new Date().toISOString();
    copyDb
      .prepare(
        `INSERT OR IGNORE INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
         VALUES ('check-hand-1', 'Rinnovare il dominio di Mori', NULL, 'open', NULL, ?, ?)`,
      )
      .run(handTs, handTs);
    const [{ n: callTodos }] = copyDb
      .prepare(`SELECT COUNT(*) n FROM session_action_item WHERE status = 'open'`)
      .all();
    const [{ n: handTodos }] = copyDb.prepare(`SELECT COUNT(*) n FROM companion_todo WHERE status = 'open'`).all();
    console.log(`  misura · aperte nella copia: ${callTodos} dalle call, ${handTodos} scritte a mano`);
    copyDb.close();

    const { mods: m2, close: close2 } = await loadModules(["recall", "db"]);
    stubs.invokeHandlers.set("get_db_url", () => `sqlite:${realCopy}`);
    // a second module graph gets its own db() singleton, so it opens the copy
    const r1 = await m2.recall.retrieve("cosa devo fare?");
    const r2 = await m2.recall.retrieve("quanto budget ha confermato Marco?");
    console.log(`  misura · "cosa devo fare?" → ${r1.context.length} caratteri, ${r1.sources.length} fonti`);
    console.log(`  misura · domanda normale   → ${r2.context.length} caratteri, ${r2.sources.length} fonti`);
    check("sotto il tetto", r1.context.length <= 12000 && r2.context.length <= 12000);
    check("le cose da fare ci sono", r1.context.includes("[Cose da fare ancora aperte]"));
    check("le cose da fare vengono prima", r1.context.indexOf("[Cose da fare") === 0);
    check("con la call di origine", /, da: /.test(r1.context));
    check("con quella scritta a mano", r1.context.includes("- Rinnovare il dominio di Mori, aggiunta da te"));
    const todoBlock = r1.context.split("\n\n")[0];
    if (process.env.MORI_CHECK_SHOW) console.log(todoBlock);
    console.log(`  misura · righe nel blocco: ${(todoBlock.match(/, da: /g) ?? []).length} dalle call, ${(todoBlock.match(/, aggiunta da te/g) ?? []).length} a mano`);
    check("i chunk di trascritto ci sono", /\[.+ · \d/.test(r2.context));
    await close2();
  }

  await close();
  console.log(
    `\n${failures.length ? "FALLITI" : "TUTTO OK"}: ${passed} verifiche passate, ${failures.length} fallite`,
  );
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length ? 1 : 0);
}

// =========================================================================
// What the 4 October session added: local models, private calls, the recall
// cache, deleting audio, Markdown/citations, export, "Oggi", streaming.
async function privacyAndNewChecks({ mods, d, makeSession }) {
  const { jobs, recall, llm, db, index } = mods;
  const md = mods["ui/markdown-logic"];
  const ex = mods["export-logic"];
  const home = mods["views/home-logic"];
  const cl = mods["companion-logic"];

  // -----------------------------------------------------------------------
  section("7 · modelli locali e call private (la regola)");
  const cloud = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m" };
  const ollama = { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen2.5:7b" };
  check("localhost è locale", llm.isLocalUrl("http://localhost:11434/v1"));
  check("127.0.0.1 è locale", llm.isLocalUrl("http://127.0.0.1:1234/v1"));
  check("Groq non è locale", !llm.isLocalUrl("https://api.groq.com/openai/v1"));
  check("un indirizzo rotto non è locale", !llm.isLocalUrl("non un url"));
  check("un modello locale non chiede la chiave", llm.providerReady(ollama));
  check("il cloud senza chiave non è pronto", !llm.providerReady({ ...cloud, apiKey: "" }));
  check("senza modello non è pronto", !llm.providerReady({ ...ollama, model: " " }));
  eq("call normale → il provider principale", llm.pickProvider(false, cloud, ollama), cloud);
  eq("call privata → il modello locale", llm.pickProvider(true, cloud, ollama), ollama);
  eq("call privata senza locale → nessuno", llm.pickProvider(true, cloud, { ...ollama, model: "" }), null);
  eq("principale già locale → anche per le private", llm.pickProvider(true, ollama, { ...ollama, model: "" }), ollama);
  eq(
    "un 'locale' che punta fuori non vale",
    llm.pickProvider(true, cloud, { baseUrl: "https://evil.example/v1", apiKey: "", model: "x" }),
    null,
  );

  // -----------------------------------------------------------------------
  section("8 · coda: una call privata non va mai al cloud");
  await llm.saveConfig({ baseUrl: "http://stub/v1", apiKey: "k", model: "m" }); // "cloud"
  await llm.saveLocalConfig({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "" }); // not set up
  await makeSession("pv1", "Call privata", "Tu: il PAROLASEGRETA del term sheet e lo zafferano.");
  await d.execute(`UPDATE session SET sensitive = 1 WHERE id = 'pv1'`);
  await makeSession("pv2", "Call normale", "Tu: riunione normale sullo zafferano e il raccolto.");
  stubs.httpRequests.length = 0;
  stubs.httpReplies.length = 0;
  const extraction = JSON.stringify({
    title: "Raccolto",
    summary: "## Di cosa si è parlato\n- Il raccolto",
    actions: [],
    categories: [],
    memories: [],
  });
  stubs.httpReplies.push(extraction);
  await jobs.enqueueJob("organize", "pv1", {});
  await jobs.enqueueJob("organize", "pv2", {});
  await jobs.pumpJobs();
  const [jp1] = await d.select(`SELECT * FROM job WHERE session_id = 'pv1' AND kind = 'organize'`);
  const [jp2] = await d.select(`SELECT * FROM job WHERE session_id = 'pv2' AND kind = 'organize'`);
  eq("la privata resta in attesa", jp1.status, "pending");
  check("con il motivo detto", /^Call privata/.test(jp1.last_error ?? ""), jp1.last_error);
  eq("senza bruciare tentativi", jp1.attempts, 0);
  eq("quella normale intanto passa", jp2.status, "done");
  check(
    "nessuna richiesta contiene la call privata",
    !stubs.httpRequests.some((r) => JSON.stringify(r.body).includes("PAROLASEGRETA")),
  );
  check("è un'attesa, non un errore", jobs.isWaitingNotice({ status: jp1.status, lastError: jp1.last_error }));

  // A local model arrives: the private call goes, and only to it.
  await llm.saveLocalConfig({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen" });
  stubs.httpRequests.length = 0;
  stubs.httpReplies.push(extraction);
  await jobs.pumpJobs();
  const [jp1b] = await d.select(`SELECT * FROM job WHERE session_id = 'pv1' AND kind = 'organize'`);
  eq("con il modello locale la privata passa", jp1b.status, "done");
  check(
    "ed è andata solo al locale",
    stubs.httpRequests.length > 0 && stubs.httpRequests.every((r) => r.url.startsWith("http://localhost:11434")),
    JSON.stringify(stubs.httpRequests.map((r) => r.url)),
  );
  let refused = false;
  try {
    await mods.organize.organizeSession("pv1", { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m" });
  } catch (e) {
    refused = /privata/i.test(String(e));
  }
  check("anche forzando un provider in cloud, la privata viene rifiutata", refused);
  // A category a local model named from the private call stays local too.
  await d.execute(`INSERT INTO category (id, name, kind, source, created_at) VALUES ('c-segreta', 'CATEGORIA-SEGRETA', 'theme', 'auto', $1)`, [new Date().toISOString()]);
  await d.execute(`INSERT INTO session_category (session_id, category_id, source, created_at) VALUES ('pv1', 'c-segreta', 'auto', $1)`, [new Date().toISOString()]);
  await makeSession("pv3", "Altra normale", "Tu: si parla del raccolto di quest'anno.");
  stubs.httpRequests.length = 0;
  stubs.httpReplies.push(extraction);
  await mods.organize.organizeSession("pv3", { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m" });
  check("le categorie nate da call private non vanno al cloud", !JSON.stringify(stubs.httpRequests.map((r) => r.body)).includes("CATEGORIA-SEGRETA"));

  // -----------------------------------------------------------------------
  section("9 · il richiamo esclude le call private");
  await index.indexSession("pv1");
  await index.indexSession("pv2");
  await d.execute(
    `INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at)
     VALUES ('pv-a1', 'pv1', 'Firmare il PAROLASEGRETA', 'Tu', 'open', NULL, $1)`,
    [new Date().toISOString()],
  );
  const shut = await recall.retrieve("zafferano");
  check("niente testo privato nel contesto", !shut.context.includes("PAROLASEGRETA"));
  check("niente fonte privata", !shut.sources.some((s) => s.id === "pv1"));
  check("la call normale c'è", shut.sources.some((s) => s.id === "pv2"));
  check("e si sa quante sono escluse", shut.excludedPrivate >= 1, String(shut.excludedPrivate));
  const todosShut = await recall.retrieve("cosa devo fare?");
  check("nemmeno le sue cose da fare", !todosShut.context.includes("PAROLASEGRETA"));
  const open = await recall.retrieve("zafferano", { includePrivate: true });
  check("con un modello locale invece la legge", open.context.includes("PAROLASEGRETA"));
  eq("e non esclude niente", open.excludedPrivate, 0);

  // -----------------------------------------------------------------------
  section("10 · la cache del richiamo vede gli embedding nuovi");
  const before = await index.chunkSignature();
  const [one] = await d.select(`SELECT id FROM transcript_chunk LIMIT 1`);
  await d.execute(`UPDATE transcript_chunk SET embedding_json = '[0.1,0.2]' WHERE id = $1`, [one.id]);
  const afterSig = await index.chunkSignature();
  check("un embedding nuovo cambia la firma", before !== afterSig, `${before} → ${afterSig}`);
  await index.indexSession("pv2");
  check("anche reindicizzare con lo stesso numero di pezzi", (await index.chunkSignature()) !== afterSig);

  // -----------------------------------------------------------------------
  section("11 · eliminare una call elimina il suo audio");
  const removed = [];
  stubs.invokeHandlers.set("delete_file", ({ path: p }) => {
    removed.push(p);
    return null;
  });
  await d.execute(`UPDATE session SET audio_path = '/home/u/.mori/audio/170.flac' WHERE id = 'pv2'`);
  await db.deleteSession("pv2");
  const [{ n: gone }] = await d.select(`SELECT COUNT(*) n FROM session WHERE id = 'pv2'`);
  eq("la call non c'è più", gone, 0);
  check("il FLAC chiesto in cancellazione", removed.includes("/home/u/.mori/audio/170.flac"), JSON.stringify(removed));
  check("e il suo gemello WAV", removed.includes("/home/u/.mori/audio/170.wav"));
  eq("una call senza audio non chiede niente", db.audioFilesOf(null).length, 0);
  // A call deleted while still queued: its WAV is only in the job's payload.
  removed.length = 0;
  await makeSession("q1", "In coda", null);
  await d.execute(
    `INSERT INTO job (id, session_id, kind, status, attempts, payload_json, created_at, updated_at)
     VALUES ('q1-j', 'q1', 'transcribe', 'pending', 0, $1, $2, $2)`,
    [JSON.stringify({ wav: "C:\\Temp\\mori_rec_17.wav" }), new Date().toISOString()],
  );
  await db.deleteSession("q1");
  check("anche il WAV in coda viene tolto", removed.includes("C:\\Temp\\mori_rec_17.wav"), JSON.stringify(removed));
  check("con i suoi canali", removed.includes("C:\\Temp\\mori_rec_17.wav.mic.wav") && removed.includes("C:\\Temp\\mori_rec_17.wav.sys.wav"));
  check("e il log del registratore", removed.includes("C:\\Temp\\mori_rec_17.log"));
  eq("un file che non è una registrazione no", db.recordingFilesOf("C:\\Users\\a\\documento.wav").length, 0);

  // -----------------------------------------------------------------------
  section("12 · Markdown e citazioni");
  const srcs = [{ title: "Call" }, { title: "Call con Marco" }, { title: "Pricing del piano annuale" }];
  const blocks = md.parseMarkdown(
    "## Decisioni\n- Prezzo a **39 €** [Pricing del piano annuale · ieri]\n- Vedi [Call con Marco \u2014 19 ago 2026]\n\nTesto *corsivo* e `codice` e [link](https://x.y) e [x] e [Inventata · 1 gen].",
    srcs,
  );
  eq("titolo, lista, paragrafo", blocks.map((b) => b.t).join(","), "h,ul,p");
  eq("due voci di lista", blocks[1].items.length, 2);
  const cite0 = blocks[1].items[0].find((x) => x.t === "cite");
  eq("citazione riconosciuta", cite0?.source, 2);
  eq("vince il titolo più lungo", blocks[1].items[1].find((x) => x.t === "cite")?.source, 1);
  check("il grassetto c'è", blocks[1].items[0].some((x) => x.t === "b"));
  const para = blocks[2].lines[0];
  check("corsivo e codice", para.some((x) => x.t === "i") && para.some((x) => x.t === "code"));
  check("il link diventa testo", para.some((x) => x.t === "text" && x.v.includes("link")) && !JSON.stringify(para).includes("https://x.y"));
  check("[x] non è una citazione", !para.some((x) => x.t === "cite" && x.label === "x"));
  eq("una fonte inventata non apre niente", para.find((x) => x.t === "cite")?.source, null);
  eq("le fonti citate, in ordine", md.citedSources(blocks).join(","), "2,1");
  eq("1. 2. diventa elenco numerato", md.parseMarkdown("1. uno\n2. due")[0].t, "ol");
  eq("niente HTML: un tag resta testo", md.parseMarkdown("<b>x</b>")[0].lines[0][0].v, "<b>x</b>");
  eq("## Titolo ## perde i cancelletti finali", md.readHeading("## Titolo ##")?.text, "Titolo");
  eq("# C# tiene il suo", md.readHeading("# C#")?.text, "C#");
  eq("#hashtag non è un titolo", md.readHeading("#hashtag"), null);
  eq("####### troppi: non è un titolo", md.readHeading("####### x"), null);
  check("--- e * * * sono righe", md.isRule("---") && md.isRule("* * *") && !md.isRule("- a"));
  const evil = ["# x" + " ".repeat(4000) + "#y", "- " + " ".repeat(20000) + "x", "*a ".repeat(3000)].join("\n");
  const tEvil = performance.now();
  md.parseMarkdown(evil, srcs);
  const msEvil = performance.now() - tEvil;
  check("testi patologici non bloccano lo streaming", msEvil < 250, `${msEvil.toFixed(0)} ms`);

  // -----------------------------------------------------------------------
  section("13 · export e follow-up");
  const call = {
    title: "Kickoff: redesign/app",
    startedAt: "2026-09-15T10:00:00Z",
    participants: ["Giulia", "Marco"],
    categories: ["Clienti"],
    summary: "## Di cosa si è parlato\n- Tre schermate",
    actions: [
      { text: "Mandare il preventivo", assignee: "Tu", due: "2026-09-18", done: false },
      { text: "Mockup", assignee: "Giulia", due: null, done: true },
    ],
    decisions: [{ what: "Budget 18.000 €", figures: "18.000 €" }],
    transcript: "Tu: TRASCRITTO-RISERVATO",
  };
  const mdOut = ex.callToMarkdown(call);
  check("titolo in testa", mdOut.startsWith("# Kickoff: redesign/app\n"));
  check("i titoli della sintesi scendono di un livello", mdOut.includes("### Di cosa si è parlato"));
  check("cose da fare come checklist", mdOut.includes("- [ ] Mandare il preventivo (Tu, entro 2026-09-18)") && mdOut.includes("- [x] Mockup (Giulia)"));
  check("decisioni", mdOut.includes("## Decisioni\n- Budget 18.000 € (18.000 €)"));
  const segs = [
    { start: 0, end: 4, speaker: "Tu", text: "Ciao Giulia." },
    { start: 4, end: 9, speaker: "Tu", text: "Partiamo dal budget?" },
    { start: 9, end: 20, speaker: "Interlocutore", text: "Sì, 18.000 euro." },
    { start: 3725, end: 3730, speaker: "Tu", text: "Perfetto." },
  ];
  const nameOf = (l) => (l === "Tu" ? "Luca" : l === "Interlocutore" ? "Giulia" : l);
  const turns = ex.transcriptTurns(segs, "", nameOf);
  eq("righe di fila della stessa voce in una battuta", turns.length, 3);
  eq("trascritto come testo, per intero", ex.transcriptToText(turns), "Luca: Ciao Giulia. Partiamo dal budget?\n\nGiulia: Sì, 18.000 euro.\n\nLuca: Perfetto.\n");
  const trMd = ex.transcriptToMarkdown(call, turns, 3730);
  check("markdown: titolo, voci e durata in testa", trMd.startsWith("# Kickoff: redesign/app\n") && trMd.includes("Luca, Giulia") && trMd.includes("1:02:10"));
  check("markdown: ogni battuta con voce e minuto", trMd.includes("**Giulia** [00:09]\nSì, 18.000 euro.") && trMd.includes("**Luca** [1:02:05]\nPerfetto."));
  const memoTurns = ex.transcriptTurns([], "Tu: Ciao.\ncome va?\nInterlocutore: Bene.", nameOf);
  eq("senza tempi si legge il testo salvato", ex.transcriptToText(memoTurns), "Luca: Ciao. come va?\n\nGiulia: Bene.\n");
  const taken = new Set();
  const n1 = ex.exportFileName(call, taken);
  const n2 = ex.exportFileName(call, taken);
  eq("nome file pulito", n1, "2026-09-15 Kickoff redesign app.md");
  eq("doppioni numerati", n2, "2026-09-15 Kickoff redesign app (2).md");
  const fu = ex.followUpContext(call, "Luca");
  check("il follow-up non manda il trascritto", !fu.includes("TRASCRITTO-RISERVATO"));
  check("solo le cose ancora aperte", fu.includes("Mandare il preventivo") && !fu.includes("Mockup"));

  // -----------------------------------------------------------------------
  section("14 · Oggi");
  eq("di mattina", home.greeting(new Date(2026, 9, 4, 9)), "Buongiorno");
  eq("di pomeriggio", home.greeting(new Date(2026, 9, 4, 15)), "Buon pomeriggio");
  eq("di sera", home.greeting(new Date(2026, 9, 4, 21)), "Buonasera");
  const now = new Date(2026, 9, 4, 9);
  const due = (y, m, dd) => ({ kind: "exact", date: new Date(y, m, dd), label: "", raw: "" });
  const none = { kind: "none", date: null, label: "", raw: null };
  const T = (id, mine, d, assignee = "Tu", status = "open", at = "2026-10-01") => ({
    id, text: id, assignee, due: d, mine, status, sessionAt: at,
  });
  const list = [
    T("tardi", true, due(2026, 9, 1)),
    T("domani", true, due(2026, 9, 5)),
    T("lontano", true, due(2026, 11, 1)),
    T("senzadata", true, none),
    T("fatta", true, due(2026, 9, 1), "Tu", "done"),
    T("sara", false, due(2026, 9, 2), "Sara"),
    T("nessuno", false, none, null),
  ];
  eq("prima il ritardo, poi la settimana, poi senza data", home.myFocus(list, now, 6).map((t) => t.id).join(","), "tardi,domani,senzadata");
  eq("aspetti da altri: solo chi ha un nome", home.waitingOn(list).map((t) => t.id).join(","), "sara");
  eq("una in ritardo", home.countLate(list, now), 1);
  const sq = home.suggestQuestions({ openMine: 3, late: 1, people: ["Giulia"], projects: ["Onboarding"], lastCallTitle: "Sync" });
  eq("prima domanda: il ritardo", sq[0], "Cosa ho in ritardo e da dove viene?");
  check("una sulla persona", sq.some((x) => x.includes("Giulia")));
  eq("archivio vuoto: domande di benvenuto", home.suggestQuestions({ openMine: 0, late: 0, people: [], projects: [], lastCallTitle: null })[0], "Cosa sai fare, Mori?");
  eq("ore ascoltate", home.statsLine({ calls: 9, callsThisWeek: 2, minutes: 126, openMine: 1 }), "2 call questa settimana · 2 ore e 6 min ascoltate · 1 cosa aperta per te");

  // -----------------------------------------------------------------------
  section("15 · risposte in streaming");
  const ev = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
  const p1 = llm.parseSse(ev("Ciao") + ": keep-alive\n\n" + ev(" mondo") + "data: [DONE]\n\n");
  eq("i pezzi arrivano in ordine", p1.deltas.join(""), "Ciao mondo");
  check("e la fine viene vista", p1.done);
  const half = ev("uno") + 'data: {"choices":[{"delta":{"content":"du';
  const p2 = llm.parseSse(half);
  eq("una riga a metà aspetta il resto", p2.deltas.join(""), "uno");
  check("e resta in mano", p2.rest.startsWith("data: {"));

  // A real stream through chatStream, chunked mid-event.
  const enc = new TextEncoder();
  const body = ev("Mori") + ev(" ricorda") + ev(".") + "data: [DONE]\n\n";
  const pieces = [body.slice(0, 17), body.slice(17, 61), body.slice(61)];
  const realStubs = globalThis.__moriStubs;
  globalThis.__moriStubs = {
    ...realStubs,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: new ReadableStream({
        start(c) {
          for (const p of pieces) c.enqueue(enc.encode(p));
          c.close();
        },
      }),
    }),
  };
  const seen = [];
  const streamed = await llm.chatStream([{ role: "user", content: "x" }], cloud, (t) => seen.push(t));
  globalThis.__moriStubs = realStubs;
  eq("chatStream ricompone la risposta", streamed, "Mori ricorda.");
  check("e la mostra mentre cresce", seen.length >= 2 && seen[seen.length - 1] === "Mori ricorda.", JSON.stringify(seen));
  // A provider that answers with plain JSON instead of a stream still works.
  stubs.httpReplies.push("Risposta intera");
  const plain = await llm.chatStream([{ role: "user", content: "x" }], cloud, () => {});
  eq("senza streaming si ripiega sulla risposta intera", plain, "Risposta intera");
  // A real Response whose body is JSON (a server that ignores stream:true).
  globalThis.__moriStubs = {
    ...realStubs,
    fetch: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "JSON intero" } }] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
  };
  let jsonBody = "";
  try {
    jsonBody = await llm.chatStream([{ role: "user", content: "x" }], cloud, () => {});
  } catch (e) {
    jsonBody = "ERRORE: " + String(e);
  }
  globalThis.__moriStubs = realStubs;
  eq("un server che risponde JSON invece dello stream funziona", jsonBody, "JSON intero");

  // -----------------------------------------------------------------------
  section("16 · brief: niente call private verso il cloud");
  const dossier = {
    entity: { id: "e", kind: "person", name: "Davide", aliases: [], calls: 2, lastAt: null },
    calls: [
      { id: "pub", title: "Pubblica", startedAt: null, decisions: 0, actions: 0 },
      { id: "priv", title: "Privata", startedAt: null, decisions: 0, actions: 0 },
    ],
    theyOwe: [{ id: "1", what: "x", sessionId: "priv", due: none, dueRaw: null, quote: null, sessionTitle: "", startSec: null }],
    iOwe: [{ id: "2", what: "y", sessionId: "pub", due: none, dueRaw: null, quote: null, sessionTitle: "", startSec: null }],
    decisions: [{ id: "3", what: "z", figures: null, sessionId: "priv", sessionTitle: "", startSec: null }],
    memories: [
      { content: "segreto", kind: "fact", sessionId: "priv" },
      { content: "pubblico", kind: "fact", sessionId: "pub" },
    ],
  };
  const clean = cl.withoutPrivate(dossier, new Set(["priv"]));
  eq("restano le call pubbliche", clean.calls.map((c) => c.id).join(","), "pub");
  check("via impegni, decisioni e memorie private", !JSON.stringify(clean).includes("segreto") && clean.theyOwe.length === 0 && clean.decisions.length === 0);
  check("nel testo per il modello non c'è", !cl.buildBriefContext(clean).includes("segreto"));

  // The real getBrief: the person's calls are all public, but a memory about
  // them was born in a private call (pv1). With a cloud model it must not go.
  await llm.saveConfig({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m" });
  await llm.saveLocalConfig({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "" });
  await d.execute(`INSERT INTO entity (id, kind, name, created_at) VALUES ('e-marco', 'person', 'Marco', $1)`, [new Date().toISOString()]);
  const marco = {
    entity: { id: "e-marco", kind: "person", name: "Marco", aliases: [], calls: 1, lastAt: null },
    calls: [{ id: "pub1", title: "Call pubblica", startedAt: null, decisions: 0, actions: 0 }],
    theyOwe: [{ id: "t1", what: "mandare il budget", sessionId: "pub1", due: none, dueRaw: null, quote: null, sessionTitle: "Call pubblica", startSec: null }],
    iOwe: [],
    decisions: [{ id: "d1", what: "si parte a novembre", figures: null, sessionId: "pub1", sessionTitle: "Call pubblica", startSec: null }],
    memories: [{ content: "Marco ha un problema di SALUTE-RISERVATA", kind: "fact", sessionId: "pv1" }],
  };
  stubs.httpRequests.length = 0;
  stubs.httpReplies.push("Riga uno del brief. [Call pubblica]\nRiga due. [Call pubblica]");
  await mods.brief.getBrief(marco, true);
  check(
    "il brief in cloud non porta una memoria nata in una call privata",
    stubs.httpRequests.length === 1 && !JSON.stringify(stubs.httpRequests[0].body).includes("SALUTE-RISERVATA"),
    JSON.stringify(stubs.httpRequests.map((r) => r.url)),
  );

  // -----------------------------------------------------------------------
  section("17 · cercare una frase nei trascritti");
  const sl = mods["search-logic"];
  eq("piega accenti e maiuscole tenendo la lunghezza", sl.foldChars("Perché Zoë"), "perche zoe");
  const lines = sl.linesOf("", [
    { start: 12.5, speaker: "Tu", text: "Allora rilasciamo martedì l'onboarding, anche senza animazioni." },
    { start: 30, speaker: "Interlocutore", text: "Il GDPR va riletto prima del rilascio." },
  ]);
  const h1 = sl.findInLines(lines, "MARTEDI");
  eq("trova senza accenti né maiuscole", h1.length, 1);
  eq("evidenzia i caratteri originali", h1[0].snippet.match, "martedì");
  eq("con il secondo giusto", h1[0].start, 12.5);
  eq("una frase intera", sl.findInLines(lines, "va riletto")[0]?.speaker, "Interlocutore");
  eq("niente se non c'è", sl.findInLines(lines, "budget").length, 0);
  eq("troppo corto: niente", sl.findInLines(lines, "a").length, 0);
  const memoLines = sl.linesOf("Giulia: il preventivo arriva lunedì\nTu: va bene", []);
  eq("dal testo semplice: chi parla", memoLines[0].speaker, "Giulia");
  eq("senza tempo", memoLines[0].start, null);
  const long = "parola ".repeat(40) + "OBIETTIVO" + " fine".repeat(40);
  const sn = sl.snippetAround(long, long.indexOf("OBIETTIVO"), 9);
  check("lo snippet resta corto e tagliato sulle parole", sn.before.startsWith("…") && sn.after.endsWith("…") && (sn.before + sn.match + sn.after).length < 110);

  // -----------------------------------------------------------------------
  section("18 · chi è l'interlocutore");
  const sp = mods["speakers-logic"];
  const meta = sp.withSpeakerMap('{"altro":1}', { Interlocutore: " Giulia Ferri " });
  eq("il nome si salva ripulito", sp.parseSpeakerMap(meta).Interlocutore, "Giulia Ferri");
  check("e le altre chiavi restano", JSON.parse(meta).altro === 1);
  eq("un nome vuoto toglie la voce", sp.parseSpeakerMap(sp.withSpeakerMap(meta, { Interlocutore: "" })).Interlocutore, undefined);
  eq("metadati rotti: nessun nome", Object.keys(sp.parseSpeakerMap("{rotto")).length, 0);
  const segsN = sp.applySpeakerMap([{ speaker: "Tu", text: "a" }, { speaker: "Interlocutore", text: "b" }], { Interlocutore: "Giulia" });
  eq("i segmenti prendono il nome", segsN[1].speaker, "Giulia");
  eq("Tu resta Tu", segsN[0].speaker, "Tu");
  eq(
    "il testo cambia solo a inizio riga",
    sp.relabelText("Tu: chiedo a Interlocutore: ok?\nInterlocutore: sì", { Interlocutore: "Giulia" }),
    "Tu: chiedo a Interlocutore: ok?\nGiulia: sì",
  );
  eq("le voci da nominare", sp.otherLabelsIn([{ speaker: "Tu" }, { speaker: "Interlocutore" }], "").join(","), "Interlocutore");
  eq("anche da un trascritto semplice", sp.otherLabelsIn([], "Tu: x\nInterlocutore: y").join(","), "Interlocutore");
  eq("un trascritto importato non ne ha", sp.otherLabelsIn([], "Giulia: x\nMarco: y").length, 0);

  // "Tu" is what is stored for the user; the screen says it in its language.
  const i18nSp = mods["i18n/index"];
  i18nSp.useLangNow("en");
  eq("in inglese il mio da fare dice You", sp.assigneeLabel("Tu"), "You");
  eq("anche dentro una lista", sp.assigneeLabel("Tu, Sarah"), "You, Sarah");
  eq("un nome scritto a mano resta com'è", sp.assigneeLabel("Tullio"), "Tullio");
  eq("e anche un nome che contiene Tu", sp.assigneeLabel("Tu Nguyen"), "Tu Nguyen");
  eq("You scritto nel campo torna Tu nei dati", sp.assigneeStored("you"), "Tu");
  eq("un altro nome si salva come scritto", sp.assigneeStored("Sarah Lee"), "Sarah Lee");
  check("il da fare assegnato a You resta mio", mods["views/todo-logic"].isMine({ assignee: sp.assigneeStored("You"), text: "x", commitments: [] }));
  const mdYou = mods["export-logic"].callToMarkdown({ title: "x", startedAt: null, participants: ["Interlocutore"], categories: [], summary: "", actions: [{ text: "send the deck", assignee: "Tu", due: null, done: false }] });
  check("la call esportata dice You, e non Interlocutore", mdYou.includes("send the deck (You") && !mdYou.includes("Interlocutore"), mdYou);
  i18nSp.useLangNow("it");
  eq("in italiano resta Tu", sp.assigneeLabel("Tu, Sarah"), "Tu, Sarah");
  // No view puts a stored owner on screen without the translation: a line of
  // JSX that prints `.assignee` (as a child or as a field's value) names assigneeLabel.
  {
    const raw = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (f.name.endsWith(".tsx")) {
          fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
            if (/(^\s*\{|>\s*\{|defaultValue=\{)[^}]*\.assignee\b/.test(line) && !line.includes("assigneeLabel")) raw.push(`${f.name}:${i + 1}`);
          });
        }
      }
    };
    walk(path.join(appRoot, "src"));
    eq("nessuna vista mostra l'assegnatario senza tradurlo", raw.join(" | "), "");
  }

  // End to end: naming the voice reaches the recall chunks and the model.
  await makeSession("sp1", "Call con nome", "Tu: allora ci vediamo?\nInterlocutore: ti mando il budget entro venerdì");
  await db.setSpeakerName("sp1", "Interlocutore", "Giulia Ferri");
  await index.indexSession("sp1");
  const [chunk] = await d.select(`SELECT text FROM transcript_chunk WHERE session_id = 'sp1'`);
  check("i pezzi per il richiamo dicono chi parla", chunk.text.includes("Giulia Ferri: ti mando il budget"), chunk.text);
  const [part] = await d.select(`SELECT COUNT(*) n FROM session_participant WHERE session_id = 'sp1' AND display_name = 'Giulia Ferri'`);
  eq("e diventa partecipante della call", part.n, 1);
  stubs.httpRequests.length = 0;
  stubs.httpReplies.push(JSON.stringify({ summary: "x", actions: [], categories: [], memories: [] }));
  await mods.organize.organizeSession("sp1");
  const sent = JSON.stringify(stubs.httpRequests.map((r) => r.body));
  check("al modello arriva il nome, non 'Interlocutore'", sent.includes("Giulia Ferri: ti mando") && !sent.includes("Interlocutore: ti mando"));

  // -----------------------------------------------------------------------
  section("19 · la storia della chat non riporta al cloud le call private");
  const cs = mods.chatStore;
  const hist = [
    { role: "user", content: "com'è andato il round?" },
    { role: "assistant", content: "Davide propone 2M", sources: [{ id: "priv", title: "Round", date: "" }] },
    { role: "user", content: "e la demo?" },
    { role: "assistant", content: "giovedì", sources: [{ id: "pub", title: "Sync", date: "" }] },
  ];
  const kept = cs.withoutPrivateTurns(hist, new Set(["priv"]));
  eq("via la risposta privata e la sua domanda", kept.map((t) => t.content).join(" | "), "e la demo? | giovedì");
  eq("senza call private non cambia niente", cs.withoutPrivateTurns(hist, new Set()).length, 4);
  // A local answer that used a private to-do but showed NO source chip.
  const localAns = await recall.retrieve("cosa devo fare? PAROLASEGRETA", { includePrivate: true });
  check("il richiamo dice da quali call ha preso", localAns.usedSessions.includes("pv1"), JSON.stringify(localAns.usedSessions));
  const tid = await mods.chatStore.newThread();
  await mods.chatStore.appendMessage(tid, "user", "cosa devo fare?", null);
  await mods.chatStore.appendMessage(tid, "assistant", "firmare il segreto", [], false, localAns.usedSessions);
  await mods.chatStore.appendMessage(tid, "user", "e la demo?", null);
  await mods.chatStore.appendMessage(tid, "assistant", "giovedì", [], false, ["pub"]);
  const back = await mods.chatStore.turnsFor(tid);
  eq("salvato e riletto con la conversazione", back[1].used?.includes("pv1"), true);
  eq(
    "al cloud non torna, anche senza fonte visibile",
    cs.withoutPrivateTurns(back, await db.privateSessionIds()).map((t) => t.content).join(" | "),
    "e la demo? | giovedì",
  );
}

// The live line of a transcription, and the second language.
async function progressAndLanguageChecks({ mods }) {
  const pl = mods["progress-logic"];
  const i18n = mods["i18n/index"];
  i18n.useLangNow("it");

  // -----------------------------------------------------------------------
  section("20 · avanzamento della trascrizione e tempo che manca");
  eq("niente file, niente numero", pl.parseProgress(null), null);
  eq("un file rotto non dà una linea sbagliata", pl.parseProgress("{\"stage\": \"run\", \"do"), null);
  const load = pl.estimate(pl.parseProgress('{"stage":"load","done":0,"total":0,"started":0}'), Date.now());
  eq("mentre carica il modello non c'è percentuale", load.fraction, null);
  eq("…e la riga lo dice", pl.progressLine(load), "Preparo Whisper…");
  const t0 = 1_000_000;
  // 600 s of audio, 150 done in 30 s: 5x real time, 450 left → 90 s.
  const mid = pl.estimate({ stage: "run", done: 150, total: 600, started: t0 }, (t0 + 30) * 1000);
  eq("un quarto fatto è il 25%", mid.fraction, 0.25);
  eq("tempo che manca alla velocità vista finora", Math.round(mid.etaSecs), 90);
  eq("la riga con percentuale e stima", pl.progressLine(mid), "25% · circa 2 min");
  const early = pl.estimate({ stage: "run", done: 4, total: 600, started: t0 }, (t0 + 3) * 1000);
  eq("nei primi secondi niente stima (sarebbe rumore)", early.etaSecs, null);
  eq("…lo dice invece di inventare", pl.progressLine(early), "1% · stimo il tempo…");
  const end = pl.estimate({ stage: "run", done: 600, total: 600, started: t0 }, (t0 + 100) * 1000);
  check("mai 100% finché Whisper non ha finito", end.fraction < 1, String(end.fraction));
  eq("meno di un minuto", pl.fmtEta(42), "meno di un minuto");
  eq("ore e minuti", pl.fmtEta(3600 + 20 * 60), "circa 1 h 20 min");
  eq("ore tonde", pl.fmtEta(7200), "circa 2 h");

  // -----------------------------------------------------------------------
  section("21 · inglese");
  i18n.useLangNow("en");
  eq("la stessa riga in inglese", pl.progressLine(mid), "25% · about 2 min");
  eq("i segnaposto restano", i18n.t("+{n} in coda", { n: 2 }), "+2 queued");
  eq("una frase senza voce ricade sull'italiano", i18n.t("frase che non esiste"), "frase che non esiste");
  eq("le date in inglese", i18n.locale(), "en-GB");
  i18n.useLangNow("it");
  eq("e di nuovo in italiano", i18n.t("+{n} in coda", { n: 2 }), "+2 in coda");

  // Every t("…") written in the code has its English. Read from the sources, so
  // a new string without a translation fails here instead of shipping in Italian.
  const dict = mods["i18n/en"].EN;
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "i18n") walk(full); }
      else if (/\.(ts|tsx)$/.test(f.name)) files.push(full);
    }
  };
  walk(path.join(appRoot, "src"));
  const missing = new Set();
  let seen = 0;
  const re = /\bt[n]?\(\s*(?:[\w.]+\s*,\s*)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) {
      let key;
      try { key = m[1].startsWith("'") ? m[1].slice(1, -1).replace(/\\'/g, "'") : JSON.parse(m[1]); } catch { continue; }
      seen++;
      if (!(key in dict)) missing.add(`${path.relative(appRoot, f)}: ${key}`);
    }
  }
  check(`ogni testo dell'interfaccia ha l'inglese (${seen} trovati)`, missing.size === 0, [...missing].slice(0, 15).join(" · "));
  const ph = (x) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const badPh = Object.entries(dict).filter(([it, en]) => ph(it) !== ph(en)).map(([it]) => it);
  check("le traduzioni hanno gli stessi segnaposto", badPh.length === 0, badPh.slice(0, 10).join(" · "));
}

// Faster understanding (pacing from the provider's own numbers), the cloud
// Whisper that never sees a private call, and the audio that is not kept.
async function speedAndAudioChecks({ mods, d, makeSession }) {
  const { llm, organize, jobs, recorder } = mods;
  mods["i18n/index"].useLangNow("it");

  // -----------------------------------------------------------------------
  section("22 · il ritmo lo dice il provider, non un'attesa fissa");
  eq("secondi con decimali", llm.parseResetMs("7.66s"), 7660);
  eq("minuti e secondi", llm.parseResetMs("1m2.5s"), 62500);
  eq("millisecondi", llm.parseResetMs("250ms"), 250);
  eq("retry-after in secondi", llm.parseResetMs("2"), 2000);
  eq("illeggibile", llm.parseResetMs("domani"), null);
  const now = 1_000_000;
  eq("c'è budget: si parte subito", llm.budgetWaitMs({ limit: 8000, remaining: 7000, resetAt: now + 30_000 }, 5000, now), 0);
  eq("budget finito: si aspetta solo fino al reset", llm.budgetWaitMs({ limit: 8000, remaining: 1000, resetAt: now + 3000 }, 5000, now), 3250);
  eq("non si sa niente: nessuna attesa", llm.budgetWaitMs(undefined, 5000, now), 0);
  const cfgT = { baseUrl: "https://api.example.test/v1", apiKey: "k", model: "m" };
  const hdrs = new Map([["x-ratelimit-limit-tokens", "60000"], ["x-ratelimit-remaining-tokens", "59000"], ["x-ratelimit-reset-tokens", "1s"]]);
  llm.noteRateHeaders(cfgT, { get: (n) => hdrs.get(n) ?? null });
  eq("il limite al minuto si impara dalle risposte", llm.tokensPerMinute(cfgT), 60000);
  llm.noteRateHeaders(cfgT, undefined); // a fetch without headers must not throw
  eq("free tier da 8000: pezzi piccoli come prima", organize.fitTokens(8000, false), 5500);
  eq("limite alto: una call lunga in una passata", organize.fitTokens(60000, false), 24000);
  eq("limite sconosciuto: prudenza", organize.fitTokens(null, false), 5500);
  eq("modello locale: la sua finestra, non il TPM", organize.fitTokens(60000, true), 5500);

  // -----------------------------------------------------------------------
  section("23 · trascrizione veloce in cloud, mai per le call private");
  const groq = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_modello", model: "openai/gpt-oss-120b" };
  const other = { baseUrl: "https://api.openai.com/v1", apiKey: "sk", model: "gpt-4.1-mini" };
  await d.execute(`DELETE FROM app_setting WHERE key IN ('stt_mode', 'stt_key')`);
  eq("mai scelto: Groq è il default", (await recorder.loadSttSettings()).mode, "cloud");
  eq("di base va in cloud con la chiave del modello", recorder.sttCloudFor(false, groq)?.key, "gsk_modello");
  await recorder.saveSttSettings("local", "");
  eq("scelto «sul PC»: viene rispettato", (await recorder.loadSttSettings()).mode, "local");
  eq("sul PC: niente cloud", recorder.sttCloudFor(false, groq), null);
  await recorder.saveSttSettings("cloud", "");
  eq("in cloud usa la chiave del modello se è Groq", recorder.sttCloudFor(false, groq)?.key, "gsk_modello");
  eq("una call privata non va in cloud", recorder.sttCloudFor(true, groq), null);
  eq("senza chiave Groq resta sul PC", recorder.sttCloudFor(false, other), null);
  await recorder.saveSttSettings("cloud", "gsk_sua");
  eq("una chiave sua vince", recorder.sttCloudFor(false, other)?.key, "gsk_sua");
  check("riletta dal database", (await recorder.loadSttSettings()).mode === "cloud");

  await llm.saveConfig(groq);
  const seen = [];
  stubs.invokeHandlers.set("transcribe_file", (args) => {
    seen.push(args.cloud);
    return JSON.stringify({ audio_path: null, result: { text: "Parole.", language: "it", segments: [] } });
  });
  await makeSession("st1", "Normale", null);
  await makeSession("st2", "Privata", null);
  await d.execute(`UPDATE session SET sensitive = 1 WHERE id = 'st2'`);
  await jobs.enqueueJob("transcribe", "st1", { wav: "C:\\tmp\\a.wav" });
  await jobs.enqueueJob("transcribe", "st2", { wav: "C:\\tmp\\b.wav" });
  await jobs.pumpJobs();
  check("la call normale va in cloud", seen.some((c) => c?.url === "https://api.groq.com/openai/v1"), JSON.stringify(seen));
  check("la privata no, anche con il cloud scelto", seen.filter((c) => c === null).length === 1, JSON.stringify(seen));
  await recorder.saveSttSettings("local", "");

  // -----------------------------------------------------------------------
  section("24 · l'audio non si tiene (se non lo chiedi)");
  const deleted = [];
  stubs.invokeHandlers.set("delete_file", ({ path: f }) => {
    deleted.push(f);
  });
  stubs.invokeHandlers.set("transcribe_file", () =>
    JSON.stringify({ audio_path: "C:\\mori\\audio\\c1.wav", result: { text: "Ciao.", language: "it", segments: [] } }),
  );
  await recorder.saveAudioKeep("none", "");
  await makeSession("au1", "Senza audio", null);
  await jobs.enqueueJob("transcribe", "au1", { wav: "C:\\tmp\\c1.wav" });
  await jobs.pumpJobs();
  const [au1] = await d.select(`SELECT audio_path FROM session WHERE id = 'au1'`);
  const [tr1] = await d.select(`SELECT memo FROM session_transcript WHERE session_id = 'au1'`);
  eq("il trascritto c'è", tr1?.memo, "Ciao.");
  eq("l'audio non è più legato alla call", au1.audio_path, null);
  check("il file è stato cancellato", deleted.includes("C:\\mori\\audio\\c1.wav"), JSON.stringify(deleted));
  const [cmp1] = await d.select(`SELECT COUNT(*) n FROM job WHERE session_id = 'au1' AND kind = 'compress'`);
  eq("niente da comprimere", cmp1.n, 0);

  await recorder.saveAudioKeep("local", "");
  stubs.invokeHandlers.set("transcribe_file", () =>
    JSON.stringify({ audio_path: "C:\\mori\\audio\\c2.wav", result: { text: "Ciao di nuovo.", language: "it", segments: [] } }),
  );
  await makeSession("au2", "Con audio", null);
  await jobs.enqueueJob("transcribe", "au2", { wav: "C:\\tmp\\c2.wav" });
  stubs.invokeHandlers.set("compress_audio", ({ wav }) => wav.replace(/\.wav$/i, ".flac"));
  await jobs.pumpJobs();
  const [au2] = await d.select(`SELECT audio_path FROM session WHERE id = 'au2'`);
  eq("chi lo vuole sul PC lo tiene (compresso)", au2.audio_path, "C:\\mori\\audio\\c2.flac");

  // A failed transcription never loses the audio, whatever the setting.
  await recorder.saveAudioKeep("none", "");
  deleted.length = 0;
  await makeSession("au3", "Fallita", null);
  await jobs.enqueueJob("transcribe", "au3", { wav: "C:\\tmp\\c3.wav" });
  stubs.invokeHandlers.set("transcribe_file", () => {
    throw new Error("trascrizione fallita (audio salvato in C:\\tmp\\c3.wav): boom");
  });
  await jobs.pumpJobs();
  check("se la trascrizione fallisce l'audio resta", !deleted.some((f) => /c3/.test(f)), JSON.stringify(deleted));

  // "Libera spazio": only calls already transcribed lose their audio.
  await d.execute(`UPDATE session SET audio_path = 'C:\\mori\\audio\\c3.wav' WHERE id = 'au3'`);
  deleted.length = 0;
  const freed = await jobs.dropAllKeptAudio();
  check("libera lo spazio delle call trascritte", deleted.some((f) => /c2\.flac/.test(f)), JSON.stringify(deleted));
  check("non tocca l'audio di una call ancora da trascrivere", !deleted.some((f) => /c3/.test(f)), JSON.stringify(deleted));
  check("ne conta almeno una", freed >= 1, String(freed));
}

// "Capisco": which piece, which pause, which model — and "it is ready".
async function understandingChecks({ mods, d, makeSession }) {
  const { organize, jobs, llm } = mods;
  const pl = mods["progress-logic"];
  mods["i18n/index"].useLangNow("it");

  // -----------------------------------------------------------------------
  section("25 · capire una call: a che punto è, e perché aspetta");
  const now = 1_000_000;
  eq("pezzo 2 di 3", pl.understandLine({ step: 1, steps: 4, waitUntil: null }, now), "parte 2 di 3");
  eq("l'ultimo passo è la sintesi", pl.understandLine({ step: 3, steps: 4, waitUntil: null }, now), "scrivo sintesi e cose da fare");
  eq("una call corta: solo la sintesi", pl.understandLine({ step: 0, steps: 1, waitUntil: null }, now), "scrivo sintesi e cose da fare");
  eq("la pausa si conta in secondi", pl.understandLine({ step: 1, steps: 4, waitUntil: now + 22_300 }, now), "attendo il limite al minuto del modello · 23 s");
  eq("finita la pausa si torna al pezzo", pl.understandLine({ step: 1, steps: 4, waitUntil: now - 1 }, now), "parte 2 di 3");
  const f = [0, 1, 2, 3].map((i) => pl.understandFraction({ step: i, steps: 4, waitUntil: null }));
  check("la linea avanza a ogni passo, senza arrivare in fondo", f.every((x, i) => i === 0 || x > f[i - 1]) && f[3] < 1, JSON.stringify(f));

  const groq120 = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "openai/gpt-oss-120b" };
  eq("su Groq i pezzi vanno al 20b (budget suo, il doppio più veloce)", organize.mapModelFor(groq120).model, "openai/gpt-oss-20b");
  eq("con un altro modello si resta su quello", organize.mapModelFor({ ...groq120, model: "openai/gpt-oss-20b" }).model, "openai/gpt-oss-20b");
  eq("fuori da Groq nessun cambio", organize.mapModelFor({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "openai/gpt-oss-120b" }).model, "openai/gpt-oss-120b");

  // A long call, end to end: the pieces on the 20b, the final pass on the 120b,
  // the views told which piece is running, the state cleared at the end.
  await llm.saveConfig(groq120);
  const long = Array.from({ length: 900 }, (_, i) => `Tu: frase numero ${i} della call lunga, con un po' di contenuto.`).join("\n");
  await makeSession("lg1", "Registrazione lunga", long);
  const seenSteps = new Set();
  const unsub = organize.subscribeUnderstanding(() => {
    const u = organize.understandingNow();
    if (u) seenSteps.add(`${u.step}/${u.steps}`);
  });
  const pieces = Math.ceil(long.length / 14000);
  stubs.httpRequests.length = 0;
  stubs.httpReplies.length = 0;
  for (let i = 0; i < pieces; i++) stubs.httpReplies.push(JSON.stringify({ punti: [`punto ${i}`], azioni: [] }));
  stubs.httpReplies.push(
    JSON.stringify({ title: "Lunga", summary: "## Di cosa si è parlato\n- tanto", actions: [], categories: [], memories: [], entities: [], commitments: [], decisions: [] }),
  );
  await organize.organizeSession("lg1");
  unsub();
  const models = stubs.httpRequests.map((r) => r.body?.model);
  stubs.httpReplies.length = 0; // the estimate of pieces may leave one over
  check("una call lunga va a pezzi", models.length >= 3, JSON.stringify(models));
  check("i pezzi sono andati al 20b", models.slice(0, -1).every((m) => m === "openai/gpt-oss-20b"), JSON.stringify(models));
  eq("la sintesi finale al 120b", models.at(-1), "openai/gpt-oss-120b");
  check("le viste hanno visto i pezzi uno per uno", seenSteps.size >= models.length - 1, JSON.stringify([...seenSteps]));
  eq("finito, niente più «Capisco»", organize.understandingNow(), null);

  // "È pronta": the queue says so once the organize job is done.
  const readyIds = [];
  const unsubReady = jobs.subscribeReady((id) => readyIds.push(id));
  await makeSession("rd1", "Da capire", "Tu: ciao. Interlocutore: ciao.");
  stubs.httpReplies.length = 0;
  stubs.httpReplies.push(JSON.stringify({ title: "Pronta", summary: "ok", actions: [{ text: "Fare una cosa", assignee: "Tu", due: null }] }));
  await jobs.enqueueJob("organize", "rd1", {});
  await jobs.pumpJobs();
  unsubReady();
  check("capita una call, arriva «è pronta»", readyIds.includes("rd1"), JSON.stringify(readyIds));
}

// When Groq could not transcribe, the user hears why (or Mori just looks slow).
async function fallbackChecks({ mods, makeSession }) {
  const { recorder, jobs } = mods;
  mods["i18n/index"].useLangNow("it");

  // -----------------------------------------------------------------------
  section("26 · Groq non ha trascritto: lo dico, con il perché");
  check("chiave sbagliata", /chiave Groq non è valida/.test(recorder.cloudFallbackMessage('cloud: HTTP 401: {"error":"Invalid API Key"}')));
  check("audio gratuito finito", /audio gratuito/.test(recorder.cloudFallbackMessage("cloud: limite gratuito raggiunto (rate limit)")));
  check("niente rete", /non era raggiungibile/.test(recorder.cloudFallbackMessage("cloud: rete: <urlopen error timed out>")));
  check("altro: lo dico lo stesso", /Groq non ha trascritto/.test(recorder.cloudFallbackMessage("cloud: KeyError: 'segments'")));
  const r = recorder.parseTranscribeResult(
    JSON.stringify({ audio_path: null, cloud_error: "cloud: HTTP 401: no", result: { text: "Ciao.", language: "it", segments: [] } }),
  );
  eq("il motivo arriva fino all'app", r?.cloudError, "cloud: HTTP 401: no");
  eq("senza motivo: nessun avviso", recorder.parseTranscribeResult(JSON.stringify({ audio_path: null, result: { text: "Ciao." } }))?.cloudError, null);

  const heard = [];
  const unsub = jobs.subscribeCloudFallback((why) => heard.push(why));
  stubs.invokeHandlers.set("transcribe_file", () =>
    JSON.stringify({ audio_path: null, cloud_error: "cloud: limite gratuito raggiunto", result: { text: "Parole.", language: "it", segments: [] } }),
  );
  await makeSession("fb1", "Ripiegata", null);
  await jobs.enqueueJob("transcribe", "fb1", { wav: "C:\\tmp\\fb1.wav" });
  await jobs.pumpJobs();
  unsub();
  eq("la coda lo dice all'app", heard[0], "cloud: limite gratuito raggiunto");
}

// While recording: the two voices are real, and a dead side is said in time.
function liveChannelChecks({ mods }) {
  const rl = mods["recording-logic"];
  mods["i18n/index"].useLangNow("it");

  // -----------------------------------------------------------------------
  section("27 · durante la call: un lato muto si dice subito, non dopo");
  const lv = (o) => ({ mic: 0.05, sys: 0.05, micQuiet: 0, sysQuiet: 0, errs: [], ...o });
  eq("tutto bene", rl.channelIssue(lv({}), 300), null);
  eq("i primi secondi non dicono niente", rl.channelIssue(lv({ sysQuiet: 30 }), 30), null);
  eq("tu parli, l'altra parte tace da un minuto", rl.channelIssue(lv({ sysQuiet: 60, micQuiet: 2 }), 120), "sys-silent");
  eq("l'altra parte parla, tu taci da un minuto", rl.channelIssue(lv({ micQuiet: 60, sysQuiet: 3 }), 120), "mic-silent");
  eq("tacciono tutti e due: è una pausa (ci pensa lo stop automatico)", rl.channelIssue(lv({ micQuiet: 60, sysQuiet: 60 }), 120), null);
  eq("un microfono staccato si dice subito", rl.channelIssue(lv({ errs: ["mic: device lost"] }), 5), "mic-error");
  eq("anche l'uscita del PC", rl.channelIssue(lv({ errs: ["sys: device lost"] }), 5), "sys-error");
  check("il testo dice cosa controllare", /uscita audio predefinita/.test(rl.issueText("sys-silent").hint));
  eq("livelli: un file rotto non inventa niente", rl.parseLevels("{rotto"), null);
  const p = rl.parseLevels('{"mic":0.04,"sys":0,"mic_quiet":1,"sys_quiet":50,"errs":[]}');
  eq("livelli letti", p?.sysQuiet, 50);
  eq("onda: il silenzio è piatto", rl.waveLevel(0), 0);
  check("onda: la soglia del silenzio si muove appena", rl.waveLevel(0.01) < 0.2, String(rl.waveLevel(0.01)));
  check("onda: una voce normale si vede bene", rl.waveLevel(0.08) > 0.6, String(rl.waveLevel(0.08)));
  eq("onda: non oltre il massimo", rl.waveLevel(2), 1);
}

// One interface, two computers: on a Mac the keys and the words are the Mac's.
function platformChecks({ mods }) {
  const pf = mods["ui/platform"];
  const keys = mods["ui/keys"];
  const i18n = mods["i18n/index"];
  const rl = mods["recording-logic"];

  // -----------------------------------------------------------------------
  section("28 · su un Mac i tasti e le parole sono quelli del Mac");
  eq("scorciatoia di partenza su Windows", pf.defaultHotkey(false), "Ctrl+Shift+R");
  eq("scorciatoia di partenza su Mac", pf.defaultHotkey(true), "Cmd+Shift+R");
  eq("i tasti su Windows", keys.hotkeyParts("Ctrl+Shift+R", false).join(" "), "Ctrl ⇧ R");
  eq("i tasti su Mac", keys.hotkeyParts("Cmd+Shift+R", true).join(" "), "⌘ ⇧ R");
  eq("CommandOrControl è Ctrl su Windows", keys.hotkeyParts("CommandOrControl+K", false).join(" "), "Ctrl K");
  eq("CommandOrControl è ⌘ su Mac", keys.hotkeyParts("CommandOrControl+K", true).join(" "), "⌘ K");
  eq("chi ha scelto Control su Mac lo vede", keys.hotkeyParts("Ctrl+Alt+R", true).join(" "), "⌃ ⌥ R");
  eq("dentro una frase, su Windows resta com'è scritta", keys.hotkeyLabel("Ctrl+Shift+R", false), "Ctrl+Shift+R");
  eq("dentro una frase, su Mac", keys.hotkeyLabel("Cmd+Shift+R", true), "⌘⇧R");
  eq("una combinazione su Windows", pf.combo("1", false), "Ctrl 1");
  eq("una combinazione su Mac", pf.combo("1", true), "⌘1");
  eq("su Windows il testo non cambia", pf.platformText("Search or ask (Ctrl K)", false), "Search or ask (Ctrl K)");
  eq("su Mac: ⌘", pf.platformText("Search or ask (Ctrl K)", true), "Search or ask (⌘K)");
  eq("su Mac: il PC è un Mac", pf.platformText("It stays on your PC.", true), "It stays on your Mac.");
  eq("su Mac: Windows è macOS", pf.platformText("Mori listens to Windows' default audio output.", true), "Mori listens to macOS's default audio output.");
  eq("su Mac: la barra è la barra dei menu", pf.platformText("from the tray menu too", true), "from the menu bar too");
  eq("le finestre restano finestre", pf.platformText("behind other windows", true), "behind other windows");

  // Every sentence of the English dictionary, as a Mac shows it.
  const left = Object.values(mods["i18n/en"].EN).filter((v) => /Ctrl|PC|Windows|tray/.test(pf.platformText(v, true)));
  eq("in inglese su Mac non resta nessun Ctrl, PC, Windows o tray", left.join(" | "), "");

  pf.usePlatformNow(true);
  i18n.useLangNow("en");
  eq("t() parla da Mac", i18n.t("Cerca o chiedi (Ctrl K)"), "Search or ask (⌘K)");
  eq("ciò che scrive l'utente non si tocca", i18n.t("Sul tuo PC ({host}): non esce niente.", { host: "PC-di-Anna" }), "On your Mac (PC-di-Anna): nothing leaves it.");
  check("il titolo di una registrazione è in inglese", /^Recording \d\d \w{3},? \d\d:\d\d$/.test(rl.autoTitle(new Date(2026, 9, 7, 14, 22))), rl.autoTitle(new Date(2026, 9, 7, 14, 22)));
  pf.usePlatformNow(false);
  eq("t() su Windows è quello di sempre", i18n.t("Cerca o chiedi (Ctrl K)"), "Search or ask (Ctrl K)");
  i18n.useLangNow("it");
  check("il titolo in italiano resta quello di prima", /^Registrazione 07 ott,? 14:22$/.test(rl.autoTitle(new Date(2026, 9, 7, 14, 22))), rl.autoTitle(new Date(2026, 9, 7, 14, 22)));
  check("un titolo dato da Mori si riconosce, in tutte e due le lingue", rl.isAutoTitle("Registrazione 07 ott 14:22") && rl.isAutoTitle("Recording 07 Oct 14:22") && rl.isAutoTitle("Call senza titolo"));
  check("un titolo scelto dall'utente no", !rl.isAutoTitle("Kickoff Mori"));
}

// A new install speaks English, everywhere a person can read: the interface,
// the sample calls, and what the backend and the Python sidecars say when
// something goes wrong. Italian words coming back fail here, not in a screenshot.
function englishChecks({ mods }) {
  const i18n = mods["i18n/index"];
  // -----------------------------------------------------------------------
  section("29 · una installazione nuova parla inglese, ovunque");
  eq("senza una scelta salvata la lingua è l'inglese", i18n.getLangPref(), "en");

  const ITALIAN =
    /\b(non|della|delle|degli|dello|nella|nelle|sono|siamo|questa|questo|registrazione|registra|trascrizione|trascrivo|trascritto|impostazioni|riprova|salva|annulla|elimina|oggi|ieri|domani|perch[eé]|gi[aà]|pi[uù]|pu[oò]|senza|cosa|chiamata|errore|fallit[ao]|riuscit[ao]|avviat[ao]|cartella|sintesi|priorit[aà]|settimanale|draghetto|buongiorno|buonasera)\b/i;
  const hits = (texts) => texts.filter((x) => ITALIAN.test(x));

  const en = Object.entries(mods["i18n/en"].EN).filter(([, v]) => v !== "Italiano");
  eq("il dizionario inglese non ha parole italiane", hits(en.map(([, v]) => v)).join(" | "), "");

  // The sample calls a new install opens on.
  const migDir = path.join(appRoot, "src-tauri", "migrations");
  const seeds = ["0002_seed.sql", "0003_seed_raw.sql"].map((f) => fs.readFileSync(path.join(migDir, f), "utf8"));
  const seedStrings = seeds.flatMap((s) => [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]));
  eq("le call di esempio sono in inglese", hits(seedStrings).join(" | "), "");
  check("e non ci sono più Luca, Marco e Giulia", !/\b(Luca|Marco|Giulia|Elena|Studio Nord)\b/.test(seeds.join("\n")));

  // What Rust and Python say to the app: string literals outside comments.
  const literals = (file, comment) =>
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => !comment.test(l))
      .flatMap((l) => [...l.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
  const rustDir = path.join(appRoot, "src-tauri", "src");
  const rust = fs.readdirSync(rustDir).filter((f) => f.endsWith(".rs")).flatMap((f) => literals(path.join(rustDir, f), /^\s*\/\//));
  eq("il backend parla inglese", hits(rust).join(" | "), "");
  const pyDir = path.join(appRoot, "scripts");
  const py = fs
    .readdirSync(pyDir)
    .filter((f) => f.endsWith(".py"))
    .flatMap((f) => literals(path.join(pyDir, f), /^\s*(#|"""|[A-Za-z].*\.$)/))
    // "Tu" / "Interlocutore" are stored labels, translated when shown.
    .filter((x) => x !== "Tu" && x !== "Interlocutore");
  eq("gli script Python parlano inglese", hits(py).join(" | "), "");
}

// No long dash in anything a person reads: the interface, the sample calls, what
// the model is told (it writes back the way it is written to), the preview bench
// the public screenshots are taken from, the README and the docs. Comments are
// not read by anyone outside, so they are taken out before looking.
function dashChecks() {
  section("31 · nessun trattino lungo in ciò che si legge");
  const DASH = "—";
  const repo = path.resolve(appRoot, "..");
  const walk = (dir, keep) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return ["node_modules", "target", "gen", "dist", ".git"].includes(e.name) ? [] : walk(f, keep);
      return keep.test(e.name) ? [f] : [];
    });
  // Blank a comment but keep its line breaks, so a hit still names its line.
  const blank = (text, re) => text.replace(re, (m) => m.replace(/[^\n]/g, " "));
  const code = (text) => blank(blank(text, /\/\*[\s\S]*?\*\//g), /(^|\s)\/\/.*$/gm);
  const strip = {
    ".ts": code,
    ".tsx": code,
    ".mjs": code,
    ".rs": code,
    ".css": (x) => blank(x, /\/\*[\s\S]*?\*\//g),
    ".html": (x) => blank(x, /<!--[\s\S]*?-->/g),
    ".sql": (x) => blank(x, /^\s*--.*$/gm),
    ".py": (x) => blank(blank(x, /"""[\s\S]*?"""/g), /(^|\s)#.*$/gm),
    ".toml": (x) => blank(x, /(^|\s)#.*$/gm),
    ".md": (x) => x,
    ".json": (x) => x,
  };
  const files = [
    ...walk(path.join(appRoot, "src"), /\.(ts|tsx|css)$/),
    ...walk(path.join(appRoot, "src-tauri", "src"), /\.rs$/),
    ...walk(path.join(appRoot, "src-tauri", "migrations"), /\.sql$/),
    ...walk(path.join(appRoot, "src-tauri"), /^(Cargo\.toml|tauri.*\.json)$/).filter((f) => path.dirname(f) === path.join(appRoot, "src-tauri")),
    ...walk(path.join(appRoot, "preview"), /\.(ts|tsx|html)$/),
    ...walk(path.join(appRoot, "scripts"), /\.py$/),
    path.join(appRoot, "index.html"),
    ...walk(repo, /\.md$/),
  ];
  const hits = [];
  for (const f of files) {
    const text = strip[path.extname(f)](fs.readFileSync(f, "utf8"));
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(DASH)) hits.push(`${path.relative(repo, f).replace(/\\/g, "/")}:${i + 1}`);
    });
  }
  check(`ne ho guardati ${files.length}`, files.length > 100, `solo ${files.length} file`);
  eq("nessun trattino lungo fuori dai commenti", hits.join(" "), "");
  // and the looking itself works: a string is seen, a comment is not
  eq("una stringa si vede, un commento no", code(`const a = "x ${DASH} y"; // z ${DASH} w\n/* ${DASH} */`).split(DASH).length - 1, 1);
}

// First launch of a packaged Mori: what the strip under the recorder says.
function setupChecks({ mods }) {
  const sl = mods["setup-logic"];
  const i18n = mods["i18n/index"];
  // -----------------------------------------------------------------------
  section("30 · la prima apertura si prepara da sola, e dice a che punto è");
  i18n.useLangNow("en");
  eq("primo passo", sl.setupLine("python"), "1 of 3 · downloading Python");
  eq("secondo passo", sl.setupLine("packages"), "2 of 3 · audio and transcription");
  eq("terzo passo", sl.setupLine("check"), "3 of 3 · final check");
  i18n.useLangNow("it");
  eq("in italiano", sl.setupLine("packages"), "2 di 3 · audio e trascrizione");
  check("la linea avanza a ogni passo", sl.setupFraction("python") < sl.setupFraction("packages") && sl.setupFraction("packages") < sl.setupFraction("check"));
  check("e non è mai piena prima della fine", sl.setupFraction("check") < 1);
  eq("un passo sconosciuto non rompe niente", sl.parseStage("altro"), null);
  eq("un passo noto si riconosce", sl.parseStage("check"), "check");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
