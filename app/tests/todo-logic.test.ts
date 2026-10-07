// Runnable check for the "Da fare" pure logic. No test framework: run it with
//   node tests/todo-logic.test.ts            (asserts only)
//   node tests/todo-logic.test.ts <db-path>  (also classifies every real row)
// The DB argument must be a COPY of ~/.mori/mori.db — never the live file.
import assert from "node:assert/strict";
import {
  parseDue,
  bucketOf,
  isMine,
  cleanAssignee,
  parseMyNames,
  BUCKET_LABELS,
  BUCKET_ORDER,
  type Bucket,
} from "../src/views/todo-logic.ts";

const NOW = new Date(2026, 8, 18); // venerdì 18 settembre 2026
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

console.log("parseDue — the nine values that exist in the real DB");
check("null → nessuna data", () => {
  const d = parseDue(null, NOW);
  assert.equal(d.kind, "none");
  assert.equal(bucketOf(d, NOW), "senzadata");
});
check("'2024-09-08' (anno sbagliato) → data esatta, in ritardo", () => {
  const d = parseDue("2024-09-08", NOW);
  assert.equal(d.kind, "exact");
  assert.equal(d.label, "8 set");
  assert.equal(bucketOf(d, NOW), "ritardo");
});
check("'2026-08-22T17:00:00Z' → data esatta, in ritardo", () => {
  const d = parseDue("2026-08-22T17:00:00Z", NOW);
  assert.equal(d.kind, "exact");
  assert.equal(d.label, "22 ago");
  assert.equal(bucketOf(d, NOW), "ritardo");
});
check("'2026-09-10' → in ritardo di 8 giorni", () => {
  assert.equal(bucketOf(parseDue("2026-09-10", NOW), NOW), "ritardo");
});
check("'domani' → sabato 19 set, questa settimana", () => {
  const d = parseDue("domani", NOW);
  assert.equal(d.kind, "approx");
  assert.equal(d.label, "~ sab 19 set");
  assert.equal(bucketOf(d, NOW), "settimana");
});
check("'domani mattina' → come 'domani'", () => {
  assert.equal(parseDue("domani mattina", NOW).label, "~ sab 19 set");
});
check("'giovedì' da venerdì → il giovedì successivo (24 set)", () => {
  const d = parseDue("giovedì", NOW);
  assert.equal(d.label, "~ gio 24 set");
  assert.equal(bucketOf(d, NOW), "settimana");
});
check("'lunedì' da venerdì → 21 set", () => {
  assert.equal(parseDue("lunedì", NOW).label, "~ lun 21 set");
});
check("'prossima settimana' → lunedì 21 set", () => {
  assert.equal(parseDue("prossima settimana", NOW).label, "~ lun 21 set");
});

console.log("\nparseDue — casi limite");
check("senza accento: 'giovedi' = 'giovedì'", () => {
  assert.equal(parseDue("giovedi", NOW).label, parseDue("giovedì", NOW).label);
});
check("'oggi' → oggi, bucket questa settimana", () => {
  const d = parseDue("oggi", NOW);
  assert.equal(bucketOf(d, NOW), "settimana");
});
check("'12/10' → 12 ottobre, più avanti", () => {
  const d = parseDue("12/10", NOW);
  assert.equal(d.label, "12 ott");
  assert.equal(bucketOf(d, NOW), "avanti");
});
check("'venerdì' detto di venerdì → il venerdì dopo, non oggi", () => {
  assert.equal(parseDue("venerdì", NOW).label, "~ ven 25 set");
});
check("testo non leggibile → resta visibile e finisce in 'senza data'", () => {
  const d = parseDue("quando torna dalle ferie", NOW);
  assert.equal(d.kind, "unknown");
  assert.equal(d.label, "quando torna dalle ferie");
  assert.equal(bucketOf(d, NOW), "senzadata");
});
check("+8 giorni → più avanti, +7 → questa settimana", () => {
  assert.equal(bucketOf(parseDue("2026-09-25", NOW), NOW), "settimana");
  assert.equal(bucketOf(parseDue("2026-09-26", NOW), NOW), "avanti");
});

console.log("\ncleanAssignee — 'null' come testo non è una persona");
for (const junk of ["null", "NULL", " Null ", "none", "None", "nil", "undefined", "n/a", "N/A", "nessuno", "Nessuna", "-", "—", "", "   "])
  check(`${JSON.stringify(junk)} → nessuno`, () => assert.equal(cleanAssignee(junk), null));
check("null e undefined veri → nessuno", () => {
  assert.equal(cleanAssignee(null), null);
  assert.equal(cleanAssignee(undefined), null);
});
// I nomi che esistono nel DB vero restano come sono (a parte gli spazi attorno).
for (const name of ["Tu", "te", "Interlocutore", "Stefano Bianchi", "Team", "team", "Tutti", "Sarah, Andrew", "Android", "Nullo", "Nessuno Rossi"])
  check(`${JSON.stringify(name)} resta`, () => assert.equal(cleanAssignee(name), name));
check("gli spazi attorno si tolgono", () => assert.equal(cleanAssignee("  Alberto "), "Alberto"));

console.log("\nisMine");
// What a user has set in Settings: the default pronouns plus their own name.
const NAMES = parseMyNames("Tu, te, io, me, Lorenzo");
check("'Tu' è mia", () => assert.equal(isMine({ assignee: "Tu", text: "x", commitments: [] }, NAMES), true));
check("'Lorenzo' è mia", () => assert.equal(isMine({ assignee: "Lorenzo", text: "x", commitments: [] }, NAMES), true));
check("'te' è mia", () => assert.equal(isMine({ assignee: "te", text: "x", commitments: [] }, NAMES), true));
check("'Interlocutore' non è mia", () =>
  assert.equal(isMine({ assignee: "Interlocutore", text: "x", commitments: [] }, NAMES), false));
check("'Sarah, Andrew' non è mia", () =>
  assert.equal(isMine({ assignee: "Sarah, Andrew", text: "x", commitments: [] }, NAMES), false));
check("lista che mi contiene: 'Lorenzo, Andrew' è mia", () =>
  assert.equal(isMine({ assignee: "Lorenzo, Andrew", text: "x", commitments: [] }, NAMES), true));
check("senza assegnatario, con un mio impegno che dice la stessa cosa → mia", () =>
  assert.equal(
    isMine(
      {
        assignee: null,
        text: "Fornire accesso GitHub aziendale a Julio",
        commitments: [{ who: "Tu", what: "Fornire accesso GitHub aziendale, Notion, AWS e token iOS" }],
      },
      NAMES,
    ),
    true,
  ));
check("senza assegnatario, impegno di un altro → non mia", () =>
  assert.equal(
    isMine(
      {
        assignee: null,
        text: "Creare nuovo account GitHub",
        commitments: [{ who: "Julio", what: "Creare nuovo account GitHub con email aziendale" }],
      },
      NAMES,
    ),
    false,
  ));
check("senza assegnatario e senza impegni → non mia", () =>
  assert.equal(isMine({ assignee: null, text: "qualcosa", commitments: [] }, NAMES), false));
check("assegnatario 'null' testuale: conta come nessuno, decide l'impegno", () => {
  const commitments = [{ who: "Tu", what: "completare la UI della home" }];
  assert.equal(isMine({ assignee: "null", text: "Completare la UI della home oggi", commitments }, NAMES), true);
  assert.equal(isMine({ assignee: "null", text: "Completare la UI della home oggi", commitments: [] }, NAMES), false);
});
check("nomi personalizzabili: aggiungendo 'Alenso' diventa mia", () =>
  assert.equal(
    isMine({ assignee: "Alenso", text: "x", commitments: [] }, parseMyNames("Tu, te, Lorenzo, Alenso")),
    true,
  ));

// --- Classification of every real row (optional second argument) -------------
const dbPath = process.argv[2];
if (dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT ai.id, ai.text, ai.assignee, ai.status, ai.due_at, s.id AS sid, s.title, s.started_at
         FROM session_action_item ai JOIN session s ON s.id = ai.session_id`,
    )
    .all() as any[];
  const commits = db.prepare(`SELECT session_id, who, what FROM commitment WHERE status = 'open'`).all() as any[];
  const bySession = new Map<string, { who: string | null; what: string }[]>();
  for (const c of commits) {
    const list = bySession.get(c.session_id) ?? [];
    list.push({ who: c.who, what: c.what });
    bySession.set(c.session_id, list);
  }

  const tally: Record<string, Record<Bucket, number>> = {
    Mie: { ritardo: 0, settimana: 0, avanti: 0, senzadata: 0 },
    "Degli altri": { ritardo: 0, settimana: 0, avanti: 0, senzadata: 0 },
  };
  let done = 0;
  let unknownDue = 0;
  for (const r of rows) {
    if (r.status === "done") {
      done++;
      continue;
    }
    const due = parseDue(r.due_at, NOW);
    if (due.kind === "unknown") unknownDue++;
    const mine = isMine(
      { assignee: r.assignee, text: r.text, commitments: bySession.get(r.sid) ?? [] },
      NAMES,
    );
    tally[mine ? "Mie" : "Degli altri"][bucketOf(due, NOW)]++;
  }
  console.log(`\nClassificazione delle ${rows.length} azioni reali (oggi = 18 set 2026)`);
  for (const group of ["Mie", "Degli altri"]) {
    const t = tally[group];
    const tot = BUCKET_ORDER.reduce((n, b) => n + t[b], 0);
    console.log(`  ${group} — ${tot} aperte`);
    for (const b of BUCKET_ORDER) console.log(`      ${BUCKET_LABELS[b].padEnd(18)} ${t[b]}`);
  }
  console.log(`  Fatte: ${done}`);
  console.log(`  Scadenze non leggibili: ${unknownDue}`);
  db.close();
}

console.log(failed ? `\n${failed} controlli falliti` : "\nTutti i controlli passano");
process.exit(failed ? 1 : 0);
