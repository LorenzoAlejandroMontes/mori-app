// Controlli eseguibili sulla parte pura del compagno, più l'unione di due
// schede provata sul DB VERO — ma su una copia, mai su ~/.mori/mori.db.
//   node tests/companion-logic.test.ts <copia-del-db>
// Senza argomento salta la parte SQL e fa solo i controlli puri.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  silenceDecision,
  briefCacheKey,
  briefWorthWriting,
  parseBriefLines,
  splitCitations,
  buildBriefContext,
  type BriefSource,
} from "../src/companion-logic.ts";

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n")[0]}`);
  }
}

// --- Stop dopo un silenzio lungo --------------------------------------------
console.log("silenceDecision (soglia 8 minuti = 480 s)");
const T = { thresholdMin: 8 };
check("silenzio corto, niente conto alla rovescia", () =>
  assert.equal(silenceDecision({ ...T, silence: 120, armed: false }), "idle"));
check("a 480 s parte il conto alla rovescia", () =>
  assert.equal(silenceDecision({ ...T, silence: 480, armed: false }), "arm"));
check("già partito e ancora silenzio: si tiene", () =>
  assert.equal(silenceDecision({ ...T, silence: 600, armed: true }), "keep"));
check("ricomincia a parlare: si annulla da solo", () =>
  assert.equal(silenceDecision({ ...T, silence: 3, armed: true }), "disarm"));
check("soglia 0 = mai", () => {
  assert.equal(silenceDecision({ thresholdMin: 0, silence: 99999, armed: false }), "idle");
  assert.equal(silenceDecision({ thresholdMin: 0, silence: 99999, armed: true }), "disarm");
});
check("dopo 'continua a registrare' non ripropone al giro dopo", () => {
  // Ha premuto "continua" mentre il silenzio era a 500 s e resta zitto.
  assert.equal(silenceDecision({ ...T, silence: 505, armed: false, snoozed: true }), "idle");
  assert.equal(silenceDecision({ ...T, silence: 900, armed: false, snoozed: true }), "idle");
});
check("dopo 'continua', se qualcuno riparla la sospensione cade", () => {
  // `.silence` e' silenzio CONTINUO: torna a zero appena si riparla.
  assert.equal(silenceDecision({ ...T, silence: 4, armed: false, snoozed: true }), "unsnooze");
  // E da lì un nuovo silenzio intero fa ripartire la proposta.
  assert.equal(silenceDecision({ ...T, silence: 480, armed: false, snoozed: false }), "arm");
});
check("dopo 'continua', silenzio breve e poi lungo: si ripropone una volta sola", () => {
  const steps: [number, boolean][] = [[500, true], [3, true], [200, false], [480, false], [500, false]];
  const out: string[] = [];
  let snoozed = true;
  let armed = false;
  for (const [silence] of steps) {
    const d = silenceDecision({ ...T, silence, armed, snoozed });
    out.push(d);
    if (d === "unsnooze") snoozed = false;
    if (d === "arm") armed = true;
    if (d === "disarm") armed = false;
  }
  assert.deepEqual(out, ["idle", "unsnooze", "idle", "arm", "keep"]);
});
check("un solo 'arm': al giro dopo è 'keep', non un secondo conto alla rovescia", () => {
  assert.equal(silenceDecision({ ...T, silence: 485, armed: false }), "arm");
  assert.equal(silenceDecision({ ...T, silence: 490, armed: true }), "keep");
});

// --- Brief -------------------------------------------------------------------
type AnyDossier = Parameters<typeof briefCacheKey>[0];
const dossier = (over: Record<string, unknown> = {}): AnyDossier =>
  ({
    entity: { id: "e1", kind: "person", name: "Andrew", aliases: [], calls: 2, lastAt: null },
    calls: [
      { id: "s-new", title: "Allineamento backlog e onboarding", startedAt: "2026-09-15T10:21:52.835Z", decisions: 5, actions: 5 },
      { id: "s-old", title: "Kickoff sito nuovo", startedAt: "2026-09-11T09:15:57.004Z", decisions: 5, actions: 5 },
    ],
    theyOwe: [{ id: "c1", what: "Completare le attività SEO attuali", due: { kind: "none", date: null, label: "", raw: null }, dueRaw: null, quote: null, sessionId: "s-old", sessionTitle: "Kickoff sito nuovo", startSec: 742 }],
    iOwe: [],
    decisions: [{ id: "d1", what: "Priorità alle bio pages", figures: null, sessionId: "s-new", sessionTitle: "Allineamento backlog e onboarding", startSec: null }],
    memories: [],
    ...over,
  }) as AnyDossier;

console.log("\nBrief — chiave della cache");
check("la chiave è la call più recente", () => assert.equal(briefCacheKey(dossier()), "s-new"));
check("senza call non c'è chiave", () => assert.equal(briefCacheKey(dossier({ calls: [] })), null));
check("arriva una call nuova ⇒ la chiave cambia ⇒ il brief si rigenera", () => {
  const before = briefCacheKey(dossier());
  const after = briefCacheKey(
    dossier({
      calls: [
        { id: "s-newest", title: "Call di oggi", startedAt: "2026-09-18T09:00:00Z", decisions: 0, actions: 0 },
        ...dossier().calls,
      ],
    }),
  );
  assert.notEqual(before, after);
  assert.equal(after, "s-newest");
});
check("nessuna call nuova ⇒ stessa chiave ⇒ si riusa la cache", () =>
  assert.equal(briefCacheKey(dossier()), briefCacheKey(dossier())));

console.log("\nBrief — quando vale la pena scriverlo");
check("due fatti bastano", () => assert.equal(briefWorthWriting(dossier()), true));
check("nessuna call: no", () => assert.equal(briefWorthWriting(dossier({ calls: [] })), false));
check("una call e un solo fatto: no, si dice che è presto", () =>
  assert.equal(briefWorthWriting(dossier({ theyOwe: [], decisions: [], iOwe: [], memories: [] })), false));

console.log("\nBrief — pulizia e citazioni");
check("via i trattini, massimo sei righe", () => {
  const lines = parseBriefLines("- una\n* due\n\n• tre\nquattro\ncinque\nsei\nsette\notto");
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "una");
  assert.equal(lines[2], "tre");
});
const SRC: BriefSource[] = [
  { id: "s-new", title: "Allineamento backlog e onboarding", date: "15 set 2026" },
  { id: "s-old", title: "Kickoff sito nuovo", date: "11 set 2026" },
];
check("la fonte esce dal testo e diventa un chip", () => {
  const { text, cited } = splitCitations("Vi siete dati lunedì. [Kickoff sito nuovo]", SRC);
  assert.equal(text, "Vi siete dati lunedì.");
  assert.deepEqual(cited.map((c) => c.id), ["s-old"]);
});
check("titolo abbreviato dal modello: si riconosce lo stesso", () => {
  const { cited } = splitCitations("Testo. [Allineamento backlog]", SRC);
  assert.deepEqual(cited.map((c) => c.id), ["s-new"]);
});
check("due fonti sulla stessa riga, senza doppioni", () => {
  const { cited } = splitCitations("Testo [Kickoff sito nuovo] e ancora [Kickoff sito nuovo].", SRC);
  assert.equal(cited.length, 1);
});
check("fonte inventata dal modello: nessun chip, e la riga resta leggibile", () => {
  const { text, cited } = splitCitations("Testo. [Call che non esiste]", SRC);
  assert.equal(cited.length, 0);
  assert.equal(text, "Testo.");
});
check("il contesto per il modello non contiene il trascritto", () => {
  const ctx = buildBriefContext(dossier(), new Date(2026, 8, 18));
  assert.ok(ctx.includes("Andrew"));
  assert.ok(ctx.includes("Completare le attività SEO attuali"));
  assert.ok(ctx.includes("Call insieme:"));
  assert.ok(!/trascritto|transcript/i.test(ctx));
});

// --- Unione di due schede, sul DB reale (copiato) ----------------------------
const src = process.argv[2];
if (src) {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "mori-merge-"));
  const path = join(dir, "merge.db");
  copyFileSync(src, path);
  const db = new DatabaseSync(path);

  // Le due tabelle della 0008 non esistono nel DB di oggi: si creano come da
  // migrazione, così la prova gira sullo schema che l'app avrà davvero.
  db.exec(`CREATE TABLE IF NOT EXISTS entity_alias (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      alias TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_alias ON entity_alias(lower(alias));
    CREATE TABLE IF NOT EXISTS entity_brief (
      entity_id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
      latest_session_id TEXT, body TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]', model TEXT, created_at TEXT NOT NULL);`);

  const pick = (name: string) =>
    (db.prepare(`SELECT id, name FROM entity WHERE lower(name) = lower(?)`).get(name) as any) ?? null;

  console.log("\nUnione di due schede (copia del DB reale)");
  // Nel DB c'è "Sara" ma non "Sarah" come entità: se ne crea una, che è
  // esattamente il caso reale (due grafie della stessa persona).
  const sara = pick("Sara");
  assert.ok(sara, "il DB reale deve contenere l'entità Sara");
  const sarahId = "test-sarah";
  db.prepare(`INSERT OR IGNORE INTO entity (id, kind, name, created_at) VALUES (?,?,?,?)`).run(
    sarahId, "person", "Sarah", new Date().toISOString(),
  );
  const someSession = (db.prepare(`SELECT id FROM session LIMIT 1`).get() as any).id as string;
  db.prepare(`INSERT OR IGNORE INTO session_entity (session_id, entity_id) VALUES (?,?)`).run(someSession, sarahId);
  db.prepare(
    `INSERT INTO entity_brief (entity_id, latest_session_id, body, sources_json, model, created_at) VALUES (?,?,?,?,?,?)`,
  ).run(sara.id, "vecchia", "brief vecchio", "[]", "m", new Date().toISOString());

  const before = (db.prepare(`SELECT COUNT(*) n FROM session_entity WHERE entity_id = ?`).get(sara.id) as any).n as number;

  // Esattamente le istruzioni di mergeEntities() in src/views/people.ts.
  const iso = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO session_entity (session_id, entity_id)
     SELECT session_id, ? FROM session_entity WHERE entity_id = ?`,
  ).run(sara.id, sarahId);
  db.prepare(`DELETE FROM session_entity WHERE entity_id = ?`).run(sarahId);
  db.prepare(`UPDATE OR IGNORE entity_alias SET entity_id = ? WHERE entity_id = ?`).run(sara.id, sarahId);
  db.prepare(`INSERT OR IGNORE INTO entity_alias (id, entity_id, alias, created_at) VALUES (?,?,?,?)`).run(
    "test-alias", sara.id, "Sarah", iso,
  );
  db.prepare(`DELETE FROM entity_brief WHERE entity_id IN (?, ?)`).run(sara.id, sarahId);
  db.prepare(`DELETE FROM entity WHERE id = ?`).run(sarahId);

  check("le call della scheda assorbita passano sull'altra", () => {
    const after = (db.prepare(`SELECT COUNT(*) n FROM session_entity WHERE entity_id = ?`).get(sara.id) as any).n as number;
    assert.equal(after, before + 1);
  });
  check("la scheda assorbita sparisce", () =>
    assert.equal(db.prepare(`SELECT id FROM entity WHERE id = ?`).get(sarahId), undefined));
  check("non restano collegamenti orfani", () =>
    assert.equal((db.prepare(`SELECT COUNT(*) n FROM session_entity WHERE entity_id = ?`).get(sarahId) as any).n, 0));
  check("il nome vecchio resta come alias", () => {
    const a = db.prepare(`SELECT alias FROM entity_alias WHERE entity_id = ?`).get(sara.id) as any;
    assert.equal(a.alias, "Sarah");
  });
  check("il brief salvato viene buttato: ora copre anche le call nuove", () =>
    assert.equal(db.prepare(`SELECT entity_id FROM entity_brief WHERE entity_id = ?`).get(sara.id), undefined));
  check("l'unione non tocca le call: nessuna sessione cancellata", () =>
    assert.ok(((db.prepare(`SELECT COUNT(*) n FROM session`).get() as any).n as number) >= 14));

  db.close();
  console.log(`  (copia usata: ${path})`);
}

console.log(failed ? `\n${failed} controlli falliti` : "\nTutti i controlli passano");
process.exit(failed ? 1 : 0);
