import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { parseSpeakerMap, withSpeakerMap, type SpeakerMap } from "./speakers-logic";
import { cleanAssignee } from "./views/todo-logic";
import { t } from "./i18n";

let _db: Database | null = null;
let _loading: Promise<Database> | null = null;

export async function db(): Promise<Database> {
  if (_db) return _db;
  if (_loading) return _loading;
  _loading = (async () => {
    // One stable DB path resolved by the backend (~/.mori/mori.db).
    const url = await invoke<string>("get_db_url");
    const d = await Database.load(url);
    // Harden concurrent access: WAL lets readers and the writer coexist,
    // busy_timeout makes a query wait instead of failing with "database is locked".
    try {
      await d.execute("PRAGMA busy_timeout = 5000;");
      await d.execute("PRAGMA journal_mode = WAL;");
    } catch {
      // pragmas are best-effort; ignore if the driver rejects them
    }
    _db = d;
    return d;
  })();
  return _loading;
}

export type Session = {
  id: string;
  title: string;
  kind: string;
  status: string;
  folder_path: string;
  started_at: string | null;
  participants: string | null;
  /** 1 = private call: only a model on this machine may read it (DECISIONS.md, rule 3). */
  sensitive: number;
};

export type Category = {
  id: string;
  name: string;
  color: string | null;
  kind: string;
  source: string;
};

export type Participant = {
  display_name: string;
  role: string | null;
  organization: string | null;
};

export type ActionItem = {
  id: string;
  text: string;
  assignee: string | null;
  status: string;
  due_at: string | null;
};

export type Memory = {
  content: string;
  kind: string;
  subject_type: string;
  subject_id: string | null;
};

// One timestamped, speaker-tagged line of a transcript (from Whisper via the
// Python scripts). `speaker` is "Tu" / "Interlocutore" (diarized) or "" (single).
export type Segment = {
  start: number;
  end: number;
  speaker: string;
  text: string;
};

export async function listSessions(): Promise<Session[]> {
  const d = await db();
  return d.select<Session[]>(
    `SELECT s.id, s.title, s.kind, s.status, s.folder_path, s.started_at, s.sensitive,
            (SELECT group_concat(p.display_name, ', ')
               FROM session_participant p WHERE p.session_id = s.id) AS participants
       FROM session s ORDER BY COALESCE(s.started_at, s.created_at) DESC`,
  );
}

/** Mark a call private (only a local model may read it) or lift it. */
export async function setSessionSensitive(id: string, on: boolean): Promise<void> {
  const d = await db();
  await d.execute(`UPDATE session SET sensitive = $1, updated_at = $2 WHERE id = $3`, [
    on ? 1 : 0,
    new Date().toISOString(),
    id,
  ]);
}

/** Whether one call is private. */
export async function isSessionSensitive(id: string): Promise<boolean> {
  const d = await db();
  const [row] = await d.select<{ sensitive: number | null }[]>(`SELECT sensitive FROM session WHERE id = $1`, [id]);
  return (row?.sensitive ?? 0) === 1;
}

/** Who "Interlocutore" (and any other recorder label) was, for one call. */
export async function speakerMapFor(sessionId: string): Promise<SpeakerMap> {
  const d = await db();
  const [row] = await d.select<{ metadata_json: string | null }[]>(
    `SELECT metadata_json FROM session WHERE id = $1`,
    [sessionId],
  );
  return parseSpeakerMap(row?.metadata_json);
}

/** Name a voice of one call ("" clears it). The name also joins the call's
 *  participants, so it shows on the call and feeds Whisper's vocabulary. */
export async function setSpeakerName(sessionId: string, label: string, name: string): Promise<void> {
  const d = await db();
  const [row] = await d.select<{ metadata_json: string | null }[]>(
    `SELECT metadata_json FROM session WHERE id = $1`,
    [sessionId],
  );
  const map = { ...parseSpeakerMap(row?.metadata_json), [label]: name.trim() };
  await d.execute(`UPDATE session SET metadata_json = $1, updated_at = $2 WHERE id = $3`, [
    withSpeakerMap(row?.metadata_json, map),
    new Date().toISOString(),
    sessionId,
  ]);
  const nm = name.trim();
  if (!nm) return;
  const [dup] = await d.select<{ n: number }[]>(
    `SELECT COUNT(*) n FROM session_participant WHERE session_id = $1 AND lower(display_name) = lower($2)`,
    [sessionId, nm],
  );
  if (!dup?.n) {
    await d.execute(
      `INSERT INTO session_participant (id, session_id, display_name, email, role, organization)
       VALUES ($1, $2, $3, NULL, NULL, NULL)`,
      [crypto.randomUUID(), sessionId, nm],
    );
  }
}

/** Ids of every private call — what must never reach a cloud model. */
export async function privateSessionIds(): Promise<Set<string>> {
  const d = await db();
  const rows = await d.select<{ id: string }[]>(`SELECT id FROM session WHERE sensitive = 1`);
  return new Set(rows.map((r) => r.id));
}

// Categories that are actually in use, with how many calls each covers — powers
// the filter chips. Ordered by frequency so the useful ones surface first.
export type CategoryCount = { id: string; name: string; color: string | null; count: number };
export async function listCategoriesWithCounts(): Promise<CategoryCount[]> {
  const d = await db();
  return d.select<CategoryCount[]>(
    `SELECT c.id, c.name, c.color, COUNT(sc.session_id) AS count
       FROM category c
       JOIN session_category sc ON sc.category_id = c.id
      GROUP BY c.id, c.name, c.color
      ORDER BY count DESC, c.name`,
  );
}

export async function renameSession(id: string, title: string): Promise<void> {
  const d = await db();
  await d.execute(`UPDATE session SET title = $1, updated_at = $2 WHERE id = $3`, [
    title.trim() || t("Call senza titolo"),
    new Date().toISOString(),
    id,
  ]);
}

/** The audio files a kept recording may exist as: the path stored on the call,
 *  plus its WAV/FLAC twin (compression can be caught between the two). */
export function audioFilesOf(audioPath: string | null | undefined): string[] {
  const p = (audioPath ?? "").trim();
  if (!p) return [];
  const twin = /\.wav$/i.test(p) ? p.replace(/\.wav$/i, ".flac") : /\.flac$/i.test(p) ? p.replace(/\.flac$/i, ".wav") : null;
  return twin ? [p, twin] : [p];
}

/** A recording still in the temp folder, with everything record.py and the
 *  transcriber leave next to it. Only `mori_rec_*` names: nothing else. */
export function recordingFilesOf(wav: string | null | undefined): string[] {
  const w = (wav ?? "").trim();
  if (!/mori_rec_[^\\/]*\.wav$/i.test(w)) return [];
  return [
    w,
    `${w}.mic.wav`,
    `${w}.sys.wav`,
    `${w}.done`,
    `${w}.started`,
    `${w}.error`,
    `${w}.silence`,
    `${w}.transcribing`,
    w.replace(/\.wav$/i, ".log"),
  ];
}

// Deletes the session and everything hanging off it (documents, transcript,
// participants, action items, category links) via ON DELETE CASCADE — and its
// kept audio. "Eliminare questa call? È definitivo." used to leave the recording
// on disk forever: a privacy promise the button did not keep.
export async function deleteSession(id: string): Promise<void> {
  const d = await db();
  const [row] = await d.select<{ audio_path: string | null }[]>(`SELECT audio_path FROM session WHERE id = $1`, [id]);
  // A call still waiting for its transcription has no audio_path yet: its WAV
  // lives only in the job's payload (and the job goes with the call).
  const queued = await d.select<{ payload_json: string | null }[]>(
    `SELECT payload_json FROM job WHERE session_id = $1 AND kind = 'transcribe'`,
    [id],
  );
  const files = new Set(audioFilesOf(row?.audio_path));
  for (const j of queued) {
    try {
      const p = JSON.parse(j.payload_json || "{}") as { wav?: string };
      for (const f of [...recordingFilesOf(p.wav), ...audioFilesOf(p.wav)]) files.add(f);
    } catch {
      /* an unreadable payload: nothing to point at */
    }
  }
  await d.execute(`DELETE FROM session WHERE id = $1`, [id]);
  for (const f of files) {
    // Best-effort: the call is already gone, a file that cannot be removed now
    // must not bring it back. The backend refuses anything outside ~/.mori.
    await invoke("delete_file", { path: f }).catch(() => {});
  }
}

// All session→category links in ONE query (avoids an N+1 of categoriesFor per
// row on every list refresh). Returns rows tagged with their session_id.
export async function allSessionCategories(): Promise<(Category & { session_id: string })[]> {
  const d = await db();
  return d.select<(Category & { session_id: string })[]>(
    `SELECT sc.session_id, c.id, c.name, c.color, c.kind, sc.source
       FROM category c
       JOIN session_category sc ON sc.category_id = c.id
      ORDER BY c.kind, c.name`,
  );
}

// Every category with its usage count, INCLUDING unused ones (LEFT JOIN) so the
// manage view can show and delete empties. Alphabetical for a stable manage list.
export async function listAllCategories(): Promise<CategoryCount[]> {
  const d = await db();
  return d.select<CategoryCount[]>(
    `SELECT c.id, c.name, c.color, COUNT(sc.session_id) AS count
       FROM category c
       LEFT JOIN session_category sc ON sc.category_id = c.id
      GROUP BY c.id, c.name, c.color
      ORDER BY lower(c.name)`,
  );
}

// Attach a category to a call by name — reusing an existing one (case-insensitive)
// or creating it. Manual links get full confidence and source 'manual'.
export async function assignCategory(sessionId: string, name: string): Promise<void> {
  const d = await db();
  const nm = name.trim();
  if (!nm) return;
  const iso = new Date().toISOString();
  let [cat] = await d.select<{ id: string }[]>(
    `SELECT id FROM category WHERE lower(name) = lower($1) LIMIT 1`,
    [nm],
  );
  if (!cat) {
    const id = crypto.randomUUID();
    await d.execute(
      `INSERT INTO category (id, name, color, kind, source, created_at)
       VALUES ($1, $2, NULL, 'theme', 'manual', $3)`,
      [id, nm, iso],
    );
    cat = { id };
  }
  await d.execute(
    `INSERT OR IGNORE INTO session_category (session_id, category_id, confidence, source, created_at)
     VALUES ($1, $2, 1.0, 'manual', $3)`,
    [sessionId, cat.id, iso],
  );
}

// Create a standalone category (no call attached yet). No-op if the name exists.
export async function createCategory(name: string): Promise<void> {
  const d = await db();
  const nm = name.trim();
  if (!nm) return;
  const [dup] = await d.select<{ id: string }[]>(
    `SELECT id FROM category WHERE lower(name) = lower($1) LIMIT 1`,
    [nm],
  );
  if (dup) return;
  await d.execute(
    `INSERT INTO category (id, name, color, kind, source, created_at)
     VALUES ($1, $2, NULL, 'theme', 'manual', $3)`,
    [crypto.randomUUID(), nm, new Date().toISOString()],
  );
}

export async function unlinkCategory(sessionId: string, categoryId: string): Promise<void> {
  const d = await db();
  await d.execute(`DELETE FROM session_category WHERE session_id = $1 AND category_id = $2`, [
    sessionId,
    categoryId,
  ]);
}

// Rename a category. If the new name collides with another category, MERGE into
// it (move the links, drop the duplicate) instead of creating two same-named tags.
export async function renameCategory(id: string, name: string): Promise<void> {
  const d = await db();
  const nm = name.trim();
  if (!nm) return;
  const [dup] = await d.select<{ id: string }[]>(
    `SELECT id FROM category WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1`,
    [nm, id],
  );
  if (dup) {
    await d.execute(
      `INSERT OR IGNORE INTO session_category (session_id, category_id, confidence, source, created_at)
       SELECT session_id, $1, confidence, source, created_at FROM session_category WHERE category_id = $2`,
      [dup.id, id],
    );
    await d.execute(`DELETE FROM session_category WHERE category_id = $1`, [id]);
    await d.execute(`DELETE FROM category WHERE id = $1`, [id]);
  } else {
    await d.execute(`UPDATE category SET name = $1 WHERE id = $2`, [nm, id]);
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const d = await db();
  await d.execute(`DELETE FROM session_category WHERE category_id = $1`, [id]);
  await d.execute(`DELETE FROM category WHERE id = $1`, [id]);
}

export async function categoriesFor(sessionId: string): Promise<Category[]> {
  const d = await db();
  return d.select<Category[]>(
    `SELECT c.id, c.name, c.color, c.kind, sc.source
       FROM category c
       JOIN session_category sc ON sc.category_id = c.id
      WHERE sc.session_id = $1
      ORDER BY c.kind, c.name`,
    [sessionId],
  );
}

export async function participantsFor(sessionId: string): Promise<Participant[]> {
  const d = await db();
  return d.select<Participant[]>(
    `SELECT display_name, role, organization
       FROM session_participant WHERE session_id = $1`,
    [sessionId],
  );
}

export async function summaryFor(sessionId: string): Promise<string> {
  const d = await db();
  const rows = await d.select<{ body: string }[]>(
    `SELECT body FROM session_document
      WHERE session_id = $1 ORDER BY (kind = 'summary') DESC LIMIT 1`,
    [sessionId],
  );
  return rows[0]?.body ?? "";
}

export async function transcriptFor(sessionId: string): Promise<string> {
  const d = await db();
  const rows = await d.select<{ memo: string }[]>(
    `SELECT memo FROM session_transcript WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );
  return rows[0]?.memo ?? "";
}

// Timestamped segments for click-to-play. Empty for legacy sessions (recorded
// before Phase A) whose transcript has no `segments_json`.
export async function segmentsFor(sessionId: string): Promise<Segment[]> {
  const d = await db();
  const rows = await d.select<{ segments_json: string | null }[]>(
    `SELECT segments_json FROM session_transcript WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );
  const raw = rows[0]?.segments_json;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Segment[]) : [];
  } catch {
    return [];
  }
}

// The kept audio file for a recorded session, or null if none (imported calls,
// legacy recordings). Play back via convertFileSrc(path).
export async function audioPathFor(sessionId: string): Promise<string | null> {
  const d = await db();
  const rows = await d.select<{ audio_path: string | null }[]>(
    `SELECT audio_path FROM session WHERE id = $1 LIMIT 1`,
    [sessionId],
  );
  return rows[0]?.audio_path ?? null;
}

export async function actionItemsFor(sessionId: string): Promise<ActionItem[]> {
  const d = await db();
  const rows = await d.select<ActionItem[]>(
    `SELECT id, text, assignee, status, due_at
       FROM session_action_item WHERE session_id = $1 ORDER BY status, created_at`,
    [sessionId],
  );
  return rows.map((r) => ({ ...r, assignee: cleanAssignee(r.assignee) }));
}

export async function setActionStatus(id: string, status: "open" | "done"): Promise<void> {
  const d = await db();
  await d.execute(`UPDATE session_action_item SET status = $1 WHERE id = $2`, [status, id]);
}

export async function memoriesFor(sessionId: string): Promise<Memory[]> {
  const d = await db();
  return d.select<Memory[]>(
    `SELECT m.content, m.kind, m.subject_type, m.subject_id
       FROM memory m
       JOIN memory_link ml ON ml.memory_id = m.id
      WHERE ml.session_id = $1 AND m.status = 'active'`,
    [sessionId],
  );
}
