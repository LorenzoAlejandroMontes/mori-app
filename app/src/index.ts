import { db } from "./db";
import { embed } from "./embeddings";
import { applySpeakerMap, parseSpeakerMap, relabelText } from "./speakers-logic";

// Chunk a session's transcript into ~300-token passages and embed each one, so
// recall can score at chunk granularity (semantic + lexical). Segments (Phase A)
// give us timestamps and speakers; without them we fall back to splitting `memo`.

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const approxTokens = (s: string) => Math.ceil(s.length / 3.5);

const TARGET_TOKENS = 300; // aim per chunk
const MAX_TOKENS = 350; // hard ceiling before forcing a flush
const MAX_CHARS = Math.ceil(MAX_TOKENS * 3.5); // for hard-splitting a giant unit
const EMBED_BATCH = 32;

type Seg = { start: number; end: number; speaker: string; text: string };
type Chunk = { text: string; start: number | null; end: number | null; speaker: string };

// Group consecutive segments into chunks, never splitting a segment. Carries the
// first segment's start and the last's end; speaker = the single speaker if the
// chunk is one voice, else "misto".
function chunkSegments(segs: Seg[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Seg[] = [];
  let tok = 0;
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n");
    const speakers = new Set(cur.map((s) => s.speaker).filter(Boolean));
    const speaker = speakers.size === 1 ? [...speakers][0] : speakers.size === 0 ? "" : "misto";
    chunks.push({ text, start: cur[0].start ?? null, end: cur[cur.length - 1].end ?? null, speaker });
    cur = [];
    tok = 0;
  };
  for (const s of segs) {
    const t = approxTokens(s.text);
    if (tok > 0 && tok + t > TARGET_TOKENS) flush();
    cur.push(s);
    tok += t;
    if (tok >= MAX_TOKENS) flush();
  }
  flush();
  return chunks;
}

// Fallback for transcripts without segments (legacy recordings, imports): split
// by paragraph then line, hard-splitting any unit that alone exceeds the ceiling.
function chunkText(memo: string): Chunk[] {
  const paras = memo.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const rawUnits = paras.length ? paras : memo.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const units: string[] = [];
  for (const u of rawUnits) {
    if (approxTokens(u) <= MAX_TOKENS) {
      units.push(u);
    } else {
      for (let i = 0; i < u.length; i += MAX_CHARS) units.push(u.slice(i, i + MAX_CHARS));
    }
  }
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let tok = 0;
  const flush = () => {
    if (!buf.length) return;
    chunks.push({ text: buf.join("\n"), start: null, end: null, speaker: "" });
    buf = [];
    tok = 0;
  };
  for (const u of units) {
    const t = approxTokens(u);
    if (tok > 0 && tok + t > TARGET_TOKENS) flush();
    buf.push(u);
    tok += t;
    if (tok >= MAX_TOKENS) flush();
  }
  flush();
  return chunks;
}

// Prevent two concurrent indexers for the same session from interleaving their
// DELETE/INSERT and corrupting the chunk set (call sites may overlap).
const indexing = new Set<string>();

export async function indexSession(sessionId: string): Promise<void> {
  if (indexing.has(sessionId)) return;
  indexing.add(sessionId);
  try {
    const d = await db();
    const [tr] = await d.select<{ memo: string | null; segments_json: string | null; metadata_json: string | null }[]>(
      `SELECT t.memo, t.segments_json, s.metadata_json
         FROM session_transcript t JOIN session s ON s.id = t.session_id
        WHERE t.session_id = $1 LIMIT 1`,
      [sessionId],
    );
    if (!tr) return;

    let segs: Seg[] = [];
    if (tr.segments_json) {
      try {
        const p = JSON.parse(tr.segments_json);
        if (Array.isArray(p)) segs = p as Seg[];
      } catch {
        /* ignore malformed */
      }
    }
    // "Interlocutore" carries its real name in the chunks once the user gave
    // one: "cosa ha detto Giulia?" then finds Giulia's lines.
    const names = parseSpeakerMap(tr.metadata_json);
    const chunks = segs.length
      ? chunkSegments(applySpeakerMap(segs, names))
      : chunkText(relabelText(tr.memo ?? "", names));

    await d.execute(`DELETE FROM transcript_chunk WHERE session_id = $1`, [sessionId]);
    if (!chunks.length) return;

    const t = now();
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const id = uid();
      ids.push(id);
      const c = chunks[i];
      await d.execute(
        `INSERT INTO transcript_chunk (id, session_id, idx, start_sec, end_sec, speaker, text, embedding_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
        [id, sessionId, i, c.start, c.end, c.speaker, c.text, t],
      );
    }

    // Embed in batches; each batch runs the ONNX sidecar at IDLE priority.
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.text);
      const vecs = await embed(batch, "passage");
      for (let j = 0; j < vecs.length; j++) {
        await d.execute(`UPDATE transcript_chunk SET embedding_json = $1 WHERE id = $2`, [
          JSON.stringify(Array.from(vecs[j])),
          ids[i + j],
        ]);
      }
    }
  } finally {
    indexing.delete(sessionId);
  }
}

// True once a session has at least one chunk (used to skip re-indexing and to
// decide the recall path).
export async function hasChunks(sessionId: string): Promise<boolean> {
  const d = await db();
  const [row] = await d.select<{ n: number }[]>(
    `SELECT COUNT(*) n FROM transcript_chunk WHERE session_id = $1`,
    [sessionId],
  );
  return (row?.n ?? 0) > 0;
}

// Total chunk count across all sessions.
export async function chunkCount(): Promise<number> {
  const d = await db();
  const [row] = await d.select<{ n: number }[]>(`SELECT COUNT(*) n FROM transcript_chunk`);
  return row?.n ?? 0;
}

// What recall uses to know its in-memory corpus is stale. The count alone was
// not enough: indexSession inserts the chunks FIRST and embeds them after, so a
// question asked in between cached vectors-less chunks — and since embedding
// does not change the count, semantic search stayed blind to that call until
// another one was indexed. Re-indexing a call into the same number of chunks
// had the same problem with the text. Embedded count + newest row fix both.
export async function chunkSignature(): Promise<string> {
  const d = await db();
  const [row] = await d.select<{ n: number; e: number; m: string | null }[]>(
    `SELECT COUNT(*) n, COUNT(embedding_json) e, MAX(created_at) m FROM transcript_chunk`,
  );
  return `${row?.n ?? 0}|${row?.e ?? 0}|${row?.m ?? ""}`;
}

// One-shot: index every session that has a transcript but no chunks yet. Same
// progress shape as recategorizeAllSessions, for the "Indicizza tutto" action.
export async function indexAllMissing(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const d = await db();
  const rows = await d.select<{ id: string }[]>(
    `SELECT s.id FROM session s
       JOIN session_transcript t ON t.session_id = s.id
      WHERE length(COALESCE(t.memo, '')) > 0
        AND NOT EXISTS (SELECT 1 FROM transcript_chunk c WHERE c.session_id = s.id)
      ORDER BY COALESCE(s.started_at, s.created_at) DESC`,
  );
  for (let i = 0; i < rows.length; i++) {
    try {
      await indexSession(rows[i].id);
    } catch {
      /* leave this one un-indexed; keep going */
    }
    onProgress?.(i + 1, rows.length);
  }
  return rows.length;
}
