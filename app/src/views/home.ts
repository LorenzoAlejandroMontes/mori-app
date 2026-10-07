// The reads behind "Oggi". Pure choices (what goes first, what to suggest) are
// in home-logic.ts; here are only the queries.

import { db } from "../db";
import { listTodos, type Todo } from "./todos";
import { listEntities, type Entity } from "./people";

export type RawCall = { id: string; title: string; started_at: string | null };

export type HomeData = {
  todos: Todo[];
  /** Real calls with a transcript but no summary yet: Mori still has to read them. */
  raw: RawCall[];
  people: Entity[];
  projects: Entity[];
  /** Minutes of conversation Mori has listened to (from the timestamped chunks). */
  minutes: number;
  /** Real calls (the demo rows shipped by the migrations do not count). */
  realCalls: number;
  /** Demo calls still in the archive, removable from the welcome card. */
  seedCalls: number;
};

const SEED = `SELECT session_id FROM session_transcript WHERE provider = 'seed'`;

export async function loadHome(myNames: string[], now: Date = new Date()): Promise<HomeData> {
  const d = await db();
  const mine = new Set(myNames.map((n) => n.trim().toLowerCase()));
  const [todos, raw, mins, counts, entities] = await Promise.all([
    listTodos(myNames, now),
    d.select<RawCall[]>(
      `SELECT s.id, s.title, s.started_at FROM session s
         JOIN session_transcript t ON t.session_id = s.id
        WHERE length(COALESCE(t.memo, '')) > 0
          AND COALESCE(t.provider, '') <> 'seed'
          AND NOT EXISTS (SELECT 1 FROM session_document dd WHERE dd.session_id = s.id AND dd.kind = 'summary')
        ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT 5`,
    ),
    d.select<{ secs: number | null }[]>(
      `SELECT SUM(m) AS secs FROM (SELECT MAX(end_sec) AS m FROM transcript_chunk GROUP BY session_id)`,
    ),
    d.select<{ real: number; seed: number }[]>(
      `SELECT
         (SELECT COUNT(*) FROM session WHERE id NOT IN (${SEED})) AS real,
         (SELECT COUNT(*) FROM session WHERE id IN (${SEED})) AS seed`,
    ),
    listEntities(),
  ]);
  const recent = [...entities].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return {
    todos,
    raw,
    people: recent.filter((e) => e.kind === "person" && !mine.has(e.name.trim().toLowerCase())),
    projects: recent.filter((e) => e.kind === "project"),
    minutes: (mins[0]?.secs ?? 0) / 60,
    realCalls: counts[0]?.real ?? 0,
    seedCalls: counts[0]?.seed ?? 0,
  };
}

/** Remove the demo calls the first migrations ship (and only them): their
 *  memories go too, or "Mori ricorda" would keep quoting a fictional Marco. */
/** The demo calls, to hide them while "Annulla" is offered (nothing deleted). */
export async function demoCallIds(): Promise<string[]> {
  const d = await db();
  return (await d.select<{ session_id: string }[]>(SEED)).map((r) => r.session_id);
}

export async function removeDemoCalls(): Promise<number> {
  const d = await db();
  const ids = (await d.select<{ session_id: string }[]>(SEED)).map((r) => r.session_id);
  if (!ids.length) return 0;
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  // Memories born ONLY from demo calls (one also linked to a real call stays).
  await d.execute(
    `DELETE FROM memory
      WHERE id IN (SELECT memory_id FROM memory_link WHERE session_id IN (${ph}))
        AND id NOT IN (SELECT memory_id FROM memory_link WHERE session_id NOT IN (${ph}))`,
    ids,
  );
  await d.execute(`DELETE FROM session WHERE id IN (${ph})`, ids);
  // Demo categories left with no call at all.
  await d.execute(
    `DELETE FROM category
      WHERE id IN ('cat_mori', 'cat_crew', 'cat_arch', 'cat_budget', 'cat_design')
        AND id NOT IN (SELECT category_id FROM session_category)`,
  );
  return ids.length;
}
