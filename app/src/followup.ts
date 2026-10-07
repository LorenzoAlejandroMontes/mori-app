// After the call: the follow-up email nobody wants to write, and the call as a
// Markdown file you can paste anywhere or keep outside Mori. The text-shaping is
// pure and lives in export-logic.ts; here are the reads and the one LLM call.

import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { answerLanguageNote, t } from "./i18n";
import { cleanAssignee } from "./views/todo-logic";
import { chatComplete, isLocalProvider, providerFor } from "./llm";
import { callToMarkdown, exportFileName, followUpContext, type ExportCall } from "./export-logic";

export async function loadExportCall(sessionId: string, withTranscript = false): Promise<ExportCall | null> {
  const d = await db();
  const [s] = await d.select<{ title: string; started_at: string | null; sensitive: number | null }[]>(
    `SELECT title, started_at, sensitive FROM session WHERE id = $1`,
    [sessionId],
  );
  if (!s) return null;
  const [parts, cats, sum, acts, decs, tr] = await Promise.all([
    d.select<{ display_name: string }[]>(`SELECT display_name FROM session_participant WHERE session_id = $1`, [sessionId]),
    d.select<{ name: string }[]>(
      `SELECT c.name FROM category c JOIN session_category sc ON sc.category_id = c.id WHERE sc.session_id = $1 ORDER BY c.name`,
      [sessionId],
    ),
    d.select<{ body: string }[]>(
      `SELECT body FROM session_document WHERE session_id = $1 ORDER BY (kind = 'summary') DESC LIMIT 1`,
      [sessionId],
    ),
    d.select<{ text: string; assignee: string | null; due_at: string | null; status: string }[]>(
      `SELECT text, assignee, due_at, status FROM session_action_item WHERE session_id = $1 ORDER BY status, created_at`,
      [sessionId],
    ),
    d.select<{ what: string; figures: string | null }[]>(
      `SELECT what, figures FROM decision WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    ),
    withTranscript
      ? d.select<{ memo: string }[]>(`SELECT memo FROM session_transcript WHERE session_id = $1 LIMIT 1`, [sessionId])
      : Promise.resolve([] as { memo: string }[]),
  ]);
  return {
    title: s.title,
    startedAt: s.started_at,
    participants: parts.map((p) => p.display_name),
    categories: cats.map((c) => c.name),
    summary: sum[0]?.body ?? "",
    actions: acts.map((a) => ({ text: a.text, assignee: cleanAssignee(a.assignee), due: a.due_at, done: a.status === "done" })),
    decisions: decs,
    transcript: tr[0]?.memo,
    private: (s.sensitive ?? 0) === 1,
  };
}

export async function callMarkdown(sessionId: string, withTranscript = false): Promise<string> {
  const c = await loadExportCall(sessionId, withTranscript);
  if (!c) throw new Error(t("call non trovata"));
  return callToMarkdown(c);
}

const FOLLOWUP_SYSTEM = `Scrivi la mail di follow-up di una call di lavoro, in italiano, pronta da incollare.
Regole:
- Prima riga: "Oggetto: …" (breve e specifico). Poi una riga vuota e il corpo.
- Tono cordiale e professionale, da collega. Dai del tu se i partecipanti sono colleghi.
- Corpo: un ringraziamento di una riga, poi cosa abbiamo deciso, poi i prossimi passi come elenco puntato con chi fa cosa ed entro quando.
- Usa SOLO i fatti forniti. Non inventare date, numeri, nomi o impegni.
- Breve: si legge in 30 secondi. Chiudi con un saluto e lascia "[Il tuo nome]" come firma se non sai chi scrive.`;

export type FollowUpResult =
  | { state: "ok"; text: string; local: boolean }
  | { state: "nokey"; private: boolean }
  | { state: "error"; message: string };

/** A draft follow-up email for a call, written by the model the call is
 *  allowed to reach (a private call only by a local one). */
export async function draftFollowUp(sessionId: string, myName: string | null): Promise<FollowUpResult> {
  const c = await loadExportCall(sessionId, false);
  if (!c) return { state: "error", message: t("call non trovata") };
  const cfg = providerFor(!!c.private);
  if (!cfg) return { state: "nokey", private: !!c.private };
  try {
    const text = await chatComplete(
      [
        { role: "system", content: FOLLOWUP_SYSTEM + answerLanguageNote() },
        { role: "user", content: followUpContext(c, myName) },
      ],
      cfg,
      { timeoutMs: 120_000 },
    );
    return { state: "ok", text: text.trim(), local: isLocalProvider(cfg) };
  } catch (e) {
    return { state: "error", message: String(e instanceof Error ? e.message : e) };
  }
}

/** Every call as a .md file in a new dated folder under ~/.mori/export. */
export async function exportAllMarkdown(
  onProgress?: (done: number, total: number) => void,
): Promise<{ dir: string; count: number }> {
  const d = await db();
  const rows = await d.select<{ id: string }[]>(
    `SELECT id FROM session ORDER BY COALESCE(started_at, created_at)`,
  );
  const files: { name: string; content: string }[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const c = await loadExportCall(rows[i].id, true);
    if (c) files.push({ name: exportFileName(c, taken), content: callToMarkdown(c) });
    onProgress?.(i + 1, rows.length);
  }
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const folder = `mori-${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}-${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
  const dir = await invoke<string>("export_markdown", { folder, files });
  return { dir, count: files.length };
}

/** Open a folder of Mori's in the system file manager. */
export async function revealInFolder(path: string): Promise<void> {
  await invoke("reveal_path", { path });
}
