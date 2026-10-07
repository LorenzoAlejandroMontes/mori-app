import { db } from "./db";
import type { Source } from "./recall";
import type { ChatMessage } from "./llm";

// Chat that remembers. Before this, every question went to the model alone
// (system + the single question), so "e poi?" had nothing to attach to, and
// closing the app threw the conversation away. Threads and messages now live in
// the DB; the last one reopens with the app.

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
  /** Calls the answer drew on (sources AND memories, to-dos, facts). */
  used?: string[];
};

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export async function newThread(): Promise<string> {
  const d = await db();
  // Never leave empty threads behind (pressing "Nuova" twice).
  await d.execute(
    `DELETE FROM chat_thread WHERE NOT EXISTS (SELECT 1 FROM chat_message m WHERE m.thread_id = chat_thread.id)`,
  );
  const id = uid();
  const t = now();
  await d.execute(`INSERT INTO chat_thread (id, title, created_at, updated_at) VALUES ($1, NULL, $2, $2)`, [id, t]);
  return id;
}

/** The conversation to show on open: the most recent thread, or a fresh one. */
export async function loadLastThread(): Promise<{ id: string; turns: ChatTurn[] }> {
  const d = await db();
  const [row] = await d.select<{ id: string }[]>(
    `SELECT id FROM chat_thread ORDER BY updated_at DESC LIMIT 1`,
  );
  if (!row) return { id: await newThread(), turns: [] };
  return { id: row.id, turns: await turnsFor(row.id) };
}

export async function turnsFor(threadId: string): Promise<ChatTurn[]> {
  const d = await db();
  const rows = await d.select<
    { role: string; content: string; sources_json: string | null; is_error: number; used_sessions_json: string | null }[]
  >(
    `SELECT role, content, sources_json, is_error, used_sessions_json FROM chat_message
      WHERE thread_id = $1 ORDER BY created_at, rowid`,
    [threadId],
  );
  return rows.map((r) => {
    let sources: Source[] | undefined;
    if (r.sources_json) {
      try {
        const p = JSON.parse(r.sources_json);
        if (Array.isArray(p)) sources = p as Source[];
      } catch {
        /* a broken sources blob must not hide the answer */
      }
    }
    let used: string[] | undefined;
    if (r.used_sessions_json) {
      try {
        const p = JSON.parse(r.used_sessions_json);
        if (Array.isArray(p)) used = p.filter((x): x is string => typeof x === "string");
      } catch {
        /* unreadable: the sources check still applies */
      }
    }
    return {
      role: r.role === "assistant" ? "assistant" : "user",
      content: r.content,
      sources,
      error: r.is_error === 1,
      used,
    };
  });
}

export async function appendMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  sources: Source[] | null,
  isError = false,
  used: string[] = [],
): Promise<void> {
  const d = await db();
  const t = now();
  await d.execute(
    `INSERT INTO chat_message (id, thread_id, role, content, sources_json, is_error, created_at, used_sessions_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uid(),
      threadId,
      role,
      content,
      sources && sources.length ? JSON.stringify(sources) : null,
      isError ? 1 : 0,
      t,
      used.length ? JSON.stringify(used) : null,
    ],
  );
  // The first question names the thread, for a future thread list.
  await d.execute(
    `UPDATE chat_thread SET updated_at = $1, title = COALESCE(title, $2) WHERE id = $3`,
    [t, role === "user" ? content.slice(0, 80) : null, threadId],
  );
}

/** The last N turns, as the model wants them. Failed answers are left out: they
 *  are UI noise, not conversation. */
export function recentHistory(turns: ChatTurn[], maxTurns = 8): ChatMessage[] {
  return turns
    .filter((t) => !t.error)
    .slice(-maxTurns)
    .map((t) => ({ role: t.role, content: t.content }) as ChatMessage);
}

/** The conversation without the exchanges that drew on a private call (as a
 *  source, or through a memory, a to-do or a fact in its context): each such
 *  answer is dropped together with the question that asked for it. */
export function withoutPrivateTurns(turns: ChatTurn[], priv: Set<string>): ChatTurn[] {
  if (!priv.size) return turns;
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const touches =
      t.role === "assistant" &&
      ((t.sources ?? []).some((s) => priv.has(s.id)) || (t.used ?? []).some((id) => priv.has(id)));
    if (!touches) {
      out.push(t);
      continue;
    }
    if (out.length && out[out.length - 1].role === "user") out.pop();
  }
  return out;
}

// A follow-up ("e poi?", "e lui?") carries no searchable words of its own, so the
// retrieval query borrows the previous question. A full new question does not.
const FOLLOWUP_RE =
  /^\s*(e\b|ma\b|poi\b|e poi\b|quindi\b|allora\b|perch[ée]\b|come mai\b|continua\b|altro\b|dimmi di pi[uù]\b|approfondisci\b|e invece\b)/i;

export function buildRetrievalQuery(question: string, prevUserQuestion: string | null): string {
  const q = question.trim();
  if (!prevUserQuestion) return q;
  // Only a question that cannot stand on its own borrows: worded as a follow-up,
  // or too short to carry any searchable word. A normal question like "cosa devo
  // fare oggi?" must NOT be dragged towards the previous topic.
  if (FOLLOWUP_RE.test(q) || q.length < 20) return `${prevUserQuestion.trim()} ${q}`;
  return q;
}

/** The previous user question in a turn list, for buildRetrievalQuery. */
export function lastUserQuestion(turns: ChatTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") return turns[i].content;
  }
  return null;
}
