// Le query della vista "Da fare". Due sorgenti, una lista:
//   - session_action_item: quello che Mori ha capito dalle call
//   - companion_todo:      quello che l'utente ha scritto a mano (0008)
// La logica pura (scadenze, bucket, mie/degli altri) sta in todo-logic.ts.

import { db } from "../db";
import { cleanAssignee, isMine, parseDue, type Due } from "./todo-logic";
import { t } from "../i18n";

export type TodoSource = {
  /** null per le cose aggiunte a mano. */
  sessionId: string | null;
  title: string;
  startedAt: string | null;
  /** Secondo della call in cui l'impegno è stato preso, se si sa. */
  startSec: number | null;
};

export type Todo = {
  id: string;
  /** Da quale tabella viene: serve per sapere dove scrivere. */
  origin: "call" | "manual";
  text: string;
  assignee: string | null;
  status: "open" | "done";
  dueRaw: string | null;
  due: Due;
  mine: boolean;
  source: TodoSource;
};

type ActionRow = {
  id: string;
  text: string;
  assignee: string | null;
  status: string;
  due_at: string | null;
  session_id: string;
  title: string;
  started_at: string | null;
};

type ManualRow = {
  id: string;
  text: string;
  assignee: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
};

type CommitRow = { session_id: string; who: string | null; what: string; start_sec: number | null };

/** Parole in comune (>3 lettere) tra due frasi: serve ad agganciare un'azione
 *  all'impegno da cui nasce, per poter offrire il salto al minuto giusto. */
function overlap(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 3),
    );
  const A = norm(a);
  let n = 0;
  for (const t of norm(b)) if (A.has(t)) n++;
  return n;
}

export async function listTodos(myNames: string[], now: Date = new Date()): Promise<Todo[]> {
  const d = await db();
  const [actions, manual, commitments] = await Promise.all([
    d.select<ActionRow[]>(
      `SELECT ai.id, ai.text, ai.assignee, ai.status, ai.due_at,
              ai.session_id, s.title, s.started_at
         FROM session_action_item ai
         JOIN session s ON s.id = ai.session_id`,
    ),
    d.select<ManualRow[]>(
      `SELECT id, text, assignee, status, due_at, created_at FROM companion_todo`,
    ),
    d.select<CommitRow[]>(
      `SELECT session_id, who, what, start_sec FROM commitment WHERE status = 'open'`,
    ),
  ]);

  const bySession = new Map<string, CommitRow[]>();
  for (const c of commitments) {
    const list = bySession.get(c.session_id) ?? [];
    list.push(c);
    bySession.set(c.session_id, list);
  }

  const out: Todo[] = actions.map((r) => {
    const near = bySession.get(r.session_id) ?? [];
    // L'impegno che dice la stessa cosa dell'azione: se ha un minuto, il chip
    // "▶ mm:ss" porta esattamente lì nel trascritto.
    let best: CommitRow | null = null;
    let bestScore = 1;
    for (const c of near) {
      const score = overlap(c.what, r.text);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return {
      id: r.id,
      origin: "call" as const,
      text: r.text,
      assignee: cleanAssignee(r.assignee),
      status: r.status === "done" ? ("done" as const) : ("open" as const),
      dueRaw: r.due_at,
      due: parseDue(r.due_at, now),
      mine: isMine(
        { assignee: r.assignee, text: r.text, commitments: near.map((c) => ({ who: c.who, what: c.what })) },
        myNames,
      ),
      source: {
        sessionId: r.session_id,
        title: r.title,
        startedAt: r.started_at,
        startSec: best?.start_sec ?? null,
      },
    };
  });

  for (const r of manual) {
    const assignee = cleanAssignee(r.assignee);
    out.push({
      id: r.id,
      origin: "manual",
      text: r.text,
      assignee,
      status: r.status === "done" ? "done" : "open",
      dueRaw: r.due_at,
      due: parseDue(r.due_at, now),
      // Scritta da lui: è sua, a meno che non l'abbia assegnata a qualcun altro.
      mine: assignee ? isMine({ assignee, text: r.text, commitments: [] }, myNames) : true,
      source: { sessionId: null, title: t("Aggiunta da te"), startedAt: r.created_at, startSec: null },
    });
  }

  return out;
}

// --- Scritture ---------------------------------------------------------------

export async function setTodoStatus(t: Todo, status: "open" | "done"): Promise<void> {
  const d = await db();
  if (t.origin === "manual") {
    await d.execute(`UPDATE companion_todo SET status = $1, updated_at = $2 WHERE id = $3`, [
      status,
      new Date().toISOString(),
      t.id,
    ]);
  } else {
    await d.execute(`UPDATE session_action_item SET status = $1 WHERE id = $2`, [status, t.id]);
  }
}

export async function updateTodo(
  t: Todo,
  patch: { text?: string; assignee?: string | null; dueRaw?: string | null },
): Promise<void> {
  const d = await db();
  const text = patch.text !== undefined ? patch.text.trim() : t.text;
  const assignee = patch.assignee !== undefined ? cleanAssignee(patch.assignee) : t.assignee;
  const due = patch.dueRaw !== undefined ? (patch.dueRaw?.trim() || null) : t.dueRaw;
  if (!text) return;
  if (t.origin === "manual") {
    await d.execute(
      `UPDATE companion_todo SET text = $1, assignee = $2, due_at = $3, updated_at = $4 WHERE id = $5`,
      [text, assignee, due, new Date().toISOString(), t.id],
    );
  } else {
    await d.execute(`UPDATE session_action_item SET text = $1, assignee = $2, due_at = $3 WHERE id = $4`, [
      text,
      assignee,
      due,
      t.id,
    ]);
  }
}

export async function deleteTodo(t: Todo): Promise<void> {
  const d = await db();
  if (t.origin === "manual") {
    await d.execute(`DELETE FROM companion_todo WHERE id = $1`, [t.id]);
  } else {
    await d.execute(`DELETE FROM session_action_item WHERE id = $1`, [t.id]);
  }
}

export async function createTodo(input: {
  text: string;
  assignee?: string | null;
  dueRaw?: string | null;
}): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;
  const d = await db();
  const id = crypto.randomUUID();
  const iso = new Date().toISOString();
  await d.execute(
    `INSERT INTO companion_todo (id, text, assignee, status, due_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, $5, $5)`,
    [id, text, cleanAssignee(input.assignee), input.dueRaw?.trim() || null, iso],
  );
  return id;
}

/** Quante cose da fare aperte sono mie: il numero nel pannello di sinistra. */
export async function openMineCount(myNames: string[]): Promise<number> {
  const all = await listTodos(myNames);
  return all.filter((t) => t.status === "open" && t.mine).length;
}
