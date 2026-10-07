// Phrase search across every transcript, for the ⌘K palette. Reads all
// transcripts once and keeps them in memory until one changes (cheap signature
// query), so typing stays instant. Everything stays on this PC.

import { db } from "./db";
import { findInLines, linesOf, type Line, type LineHit } from "./search-logic";
import { applySpeakerMap, parseSpeakerMap, relabelText } from "./speakers-logic";

export type TranscriptHit = LineHit & { sessionId: string; title: string; startedAt: string | null };

type Doc = { sessionId: string; title: string; startedAt: string | null; lines: Line[] };

let cache: { sig: string; docs: Doc[] } | null = null;

async function docs(): Promise<Doc[]> {
  const d = await db();
  const [s] = await d.select<{ n: number; m: string | null; u: string | null }[]>(
    `SELECT COUNT(*) n, MAX(t.created_at) m, MAX(s.updated_at) u
       FROM session_transcript t JOIN session s ON s.id = t.session_id`,
  );
  const sig = `${s?.n ?? 0}|${s?.m ?? ""}|${s?.u ?? ""}`;
  if (cache && cache.sig === sig) return cache.docs;
  const rows = await d.select<
    {
      id: string;
      title: string;
      started_at: string | null;
      memo: string | null;
      segments_json: string | null;
      metadata_json: string | null;
    }[]
  >(
    `SELECT s.id, s.title, s.started_at, t.memo, t.segments_json, s.metadata_json
       FROM session s JOIN session_transcript t ON t.session_id = s.id
      ORDER BY COALESCE(s.started_at, s.created_at) DESC`,
  );
  const out: Doc[] = rows.map((r) => {
    let segs: { start: number; speaker: string; text: string }[] = [];
    if (r.segments_json) {
      try {
        const p = JSON.parse(r.segments_json);
        if (Array.isArray(p)) segs = p;
      } catch {
        /* fall back to the memo */
      }
    }
    const names = parseSpeakerMap(r.metadata_json);
    return {
      sessionId: r.id,
      title: r.title,
      startedAt: r.started_at,
      lines: linesOf(relabelText(r.memo ?? "", names), applySpeakerMap(segs, names)),
    };
  });
  cache = { sig, docs: out };
  return out;
}

/** Newest calls first, at most `perCall` lines from each, `limit` in total. */
export async function searchTranscripts(query: string, limit = 8, perCall = 2): Promise<TranscriptHit[]> {
  if (query.trim().length < 3) return [];
  const all = await docs();
  const out: TranscriptHit[] = [];
  for (const doc of all) {
    for (const h of findInLines(doc.lines, query, perCall)) {
      out.push({ ...h, sessionId: doc.sessionId, title: doc.title, startedAt: doc.startedAt });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
