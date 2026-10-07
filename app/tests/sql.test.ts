// Ogni query che le viste nuove mandano al database, eseguita davvero contro lo
// schema vero (una COPIA di ~/.mori/mori.db con sopra la migrazione 0008).
// TypeScript non sa niente di nomi di colonna: una colonna sbagliata qui si
// vedrebbe solo a runtime, come una vista vuota senza spiegazione.
//
//   node tests/sql.test.ts <copia-del-db>
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const src = process.argv[2];
if (!src) {
  console.log("serve il percorso di una COPIA del db. Salto.");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "mori-sql-"));
const path = join(dir, "sql.db");
copyFileSync(src, path);
const db = new DatabaseSync(path);
db.exec(readFileSync(new URL("../src-tauri/migrations/0008_companion.sql", import.meta.url), "utf8"));

let failed = 0;
/** Esegue la query e controlla che le colonne attese esistano davvero. */
function q(name: string, sql: string, params: Record<string, unknown>, expect: string[]) {
  try {
    const rows = db.prepare(sql).all(params as never) as Record<string, unknown>[];
    if (rows.length) {
      const got = Object.keys(rows[0]);
      const missing = expect.filter((c) => !got.includes(c));
      assert.equal(missing.length, 0, `colonne mancanti: ${missing.join(", ")} (tornate: ${got.join(", ")})`);
    }
    console.log(`  ok   ${name}  → ${rows.length} righe`);
    return rows;
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
    return [];
  }
}

const SID = (db.prepare(`SELECT id FROM session LIMIT 1`).get() as any).id as string;
const EID = (db.prepare(`SELECT id FROM entity LIMIT 1`).get() as any).id as string;

console.log("views/todos.ts");
const actions = q(
  "listTodos — azioni delle call",
  `SELECT ai.id, ai.text, ai.assignee, ai.status, ai.due_at,
          ai.session_id, s.title, s.started_at
     FROM session_action_item ai
     JOIN session s ON s.id = ai.session_id`,
  {},
  ["id", "text", "assignee", "status", "due_at", "session_id", "title", "started_at"],
);
q("listTodos — aggiunte a mano", `SELECT id, text, assignee, status, due_at, created_at FROM companion_todo`, {}, []);
q(
  "listTodos — impegni aperti",
  `SELECT session_id, who, what, start_sec FROM commitment WHERE status = 'open'`,
  {},
  ["session_id", "who", "what", "start_sec"],
);

console.log("\nviews/people.ts");
q(
  "listEntities",
  `SELECT e.id, e.kind, e.name,
          COUNT(se.session_id) AS calls,
          MAX(COALESCE(s.started_at, s.created_at)) AS last_at
     FROM entity e
     LEFT JOIN session_entity se ON se.entity_id = e.id
     LEFT JOIN session s ON s.id = se.session_id
    GROUP BY e.id, e.kind, e.name
    ORDER BY calls DESC, lower(e.name)`,
  {},
  ["id", "kind", "name", "calls", "last_at"],
);
q("listEntities — alias", `SELECT entity_id, alias FROM entity_alias`, {}, []);
q(
  "dossierFor — call insieme",
  `SELECT s.id, s.title, s.started_at,
          (SELECT COUNT(*) FROM decision dc WHERE dc.session_id = s.id) AS decisions,
          (SELECT COUNT(*) FROM session_action_item ai WHERE ai.session_id = s.id) AS actions
     FROM session_entity se
     JOIN session s ON s.id = se.session_id
    WHERE se.entity_id = $1
    ORDER BY COALESCE(s.started_at, s.created_at) DESC`,
  { $1: EID },
  ["id", "title", "started_at", "decisions", "actions"],
);
q(
  "dossierFor — impegni (IN con segnaposto costruiti)",
  `SELECT id, who, to_whom, what, due, quote, start_sec, session_id
     FROM commitment WHERE session_id IN ($1,$2) AND status = 'open'
    ORDER BY created_at DESC`,
  { $1: SID, $2: SID },
  ["id", "who", "to_whom", "what", "due", "quote", "start_sec", "session_id"],
);
q(
  "dossierFor — decisioni",
  `SELECT id, what, figures, start_sec, session_id FROM decision
    WHERE session_id IN ($1) ORDER BY created_at DESC`,
  { $1: SID },
  ["id", "what", "figures", "start_sec", "session_id"],
);
q(
  "dossierFor — memorie",
  `SELECT content, kind, subject_id FROM memory WHERE status = 'active'`,
  {},
  ["content", "kind", "subject_id"],
);

console.log("\nbrief.ts");
q(
  "readCachedBrief",
  `SELECT latest_session_id, body, sources_json, created_at FROM entity_brief WHERE entity_id = $1`,
  { $1: EID },
  [],
);
try {
  const iso = new Date().toISOString();
  const ins = `INSERT INTO entity_brief (entity_id, latest_session_id, body, sources_json, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(entity_id) DO UPDATE SET
       latest_session_id = $2, body = $3, sources_json = $4, model = $5, created_at = $6`;
  db.prepare(ins).run({ $1: EID, $2: SID, $3: "riga", $4: "[]", $5: "m", $6: iso } as never);
  // Due volte: la seconda deve aggiornare, non esplodere sulla chiave.
  db.prepare(ins).run({ $1: EID, $2: SID, $3: "riga due", $4: "[]", $5: "m", $6: iso } as never);
  const row = db.prepare(`SELECT body FROM entity_brief WHERE entity_id = ?`).get(EID) as any;
  assert.equal(row.body, "riga due");
  console.log("  ok   writeCachedBrief — ON CONFLICT(entity_id) aggiorna la riga");
} catch (e) {
  failed++;
  console.log(`  FAIL writeCachedBrief\n       ${(e as Error).message}`);
}

console.log("\nscritture di todos.ts");
const anAction = actions[0] as any;
try {
  db.prepare(`UPDATE session_action_item SET status = $1 WHERE id = $2`).run({ $1: "done", $2: anAction.id } as never);
  db.prepare(`UPDATE session_action_item SET text = $1, assignee = $2, due_at = $3 WHERE id = $4`).run({
    $1: "testo nuovo", $2: "Tu", $3: "domani", $4: anAction.id,
  } as never);
  const back = db.prepare(`SELECT text, assignee, due_at, status FROM session_action_item WHERE id = ?`).get(anAction.id) as any;
  assert.equal(back.text, "testo nuovo");
  assert.equal(back.status, "done");
  console.log("  ok   setTodoStatus + updateTodo su un'azione vera");
} catch (e) {
  failed++;
  console.log(`  FAIL scritture azione\n       ${(e as Error).message}`);
}
try {
  const iso = new Date().toISOString();
  db.prepare(
    `INSERT INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, $5, $5)`,
  ).run({ $1: "t1", $2: "scritta a mano", $3: "Tu", $4: "giovedì", $5: iso } as never);
  const row = db.prepare(`SELECT text, status, updated_at FROM companion_todo WHERE id = ?`).get("t1") as any;
  assert.equal(row.status, "open");
  assert.ok(row.updated_at, "$5 usato due volte deve riempire sia created_at sia updated_at");
  console.log("  ok   createTodo — lo stesso segnaposto usato due volte funziona");
} catch (e) {
  failed++;
  console.log(`  FAIL createTodo\n       ${(e as Error).message}`);
}

// Migrazione 0010: il "null" scritto come testo dal modello diventa un vuoto
// vero, e nient'altro cambia. Si semina una riga sporca per non dipendere da
// cosa c'è nella copia.
try {
  const [sid] = db.prepare(`SELECT id FROM session LIMIT 1`).all() as { id: string }[];
  const seed = db.prepare(
    `INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at)
     VALUES (?, ?, 'x', ?, 'open', ?, '2026-10-05')`,
  );
  seed.run("m10-a", sid.id, "null", "null");
  seed.run("m10-b", sid.id, " None ", "2026-09-14");
  seed.run("m10-c", sid.id, "Nullo", "giovedì");
  const snapshot = () =>
    db
      .prepare(
        `SELECT id, text, assignee, status, due_at FROM session_action_item
          WHERE lower(trim(coalesce(assignee, 'x'))) NOT IN ('', 'null', 'none', 'nil', 'undefined', 'n/a', 'nessuno', 'nessuna', '-')
            AND lower(trim(coalesce(due_at, 'x'))) NOT IN ('', 'null', 'none', 'n/a', 'nessuna', '-')
          ORDER BY id`,
      )
      .all();
  const total = () => (db.prepare(`SELECT COUNT(*) n FROM session_action_item`).get() as { n: number }).n;
  const cleanBefore = JSON.stringify(snapshot());
  const totalBefore = total();
  db.exec(readFileSync(new URL("../src-tauri/migrations/0010_null_text.sql", import.meta.url), "utf8"));
  const get = (id: string) =>
    db.prepare(`SELECT assignee, due_at FROM session_action_item WHERE id = ?`).get(id) as {
      assignee: string | null;
      due_at: string | null;
    };
  assert.deepEqual({ ...get("m10-a") }, { assignee: null, due_at: null });
  assert.deepEqual({ ...get("m10-b") }, { assignee: null, due_at: "2026-09-14" });
  assert.deepEqual({ ...get("m10-c") }, { assignee: "Nullo", due_at: "giovedì" });
  assert.equal(total(), totalBefore, "la migrazione non deve cancellare righe");
  const dirty = db
    .prepare(
      `SELECT COUNT(*) n FROM session_action_item
        WHERE lower(trim(assignee)) IN ('', 'null', 'none') OR lower(trim(due_at)) IN ('', 'null', 'none')`,
    )
    .get() as { n: number };
  assert.equal(dirty.n, 0, "restano 'null' testuali");
  // Le righe che erano già pulite sono identiche, byte per byte.
  const cleanAfter = JSON.parse(JSON.stringify(snapshot())) as { id: string }[];
  const wasClean = new Set((JSON.parse(cleanBefore) as { id: string }[]).map((r) => r.id));
  assert.equal(JSON.stringify(cleanAfter.filter((r) => wasClean.has(r.id))), cleanBefore);
  console.log(`  ok   migrazione 0010 — 'null' testuale svuotato, ${totalBefore} righe ancora lì, le pulite intatte`);
} catch (e) {
  failed++;
  console.log(`  FAIL migrazione 0010\n       ${(e as Error).message}`);
}

db.close();
console.log(failed ? `\n${failed} query rotte` : "\nTutte le query girano sullo schema vero");
process.exit(failed ? 1 : 0);
