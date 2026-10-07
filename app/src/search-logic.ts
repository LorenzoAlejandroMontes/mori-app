// Find a phrase inside transcripts — "where did someone say GDPR?" — and cut a
// readable snippet around it, with the exact match marked. Accent- and
// case-insensitive ("perche" finds "perché"), and the highlight stays on the
// ORIGINAL characters. Pure, for scripts/checks.mjs.

export type Line = { start: number | null; speaker: string; text: string };

export type Snippet = { before: string; match: string; after: string };

export type LineHit = { start: number | null; speaker: string; snippet: Snippet };

/** One normalized character per original character, so indices line up:
 *  lowercase, accents dropped. "Perché" → "perche" (same length). */
export function foldChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    // Keep the length identical: a character that folds to nothing or to
    // several characters (rare ligatures) stays itself.
    out += f.length === ch.length ? f : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

/** Normalize a query: folded, single spaces, trimmed. */
export function foldQuery(q: string): string {
  return foldChars(q).replace(/\s+/g, " ").trim();
}

/** The snippet around [at, at+len) in `text`, cut on word boundaries. */
export function snippetAround(text: string, at: number, len: number, radius = 40): Snippet {
  let from = Math.max(0, at - radius);
  let to = Math.min(text.length, at + len + radius);
  if (from > 0) {
    const sp = text.indexOf(" ", from);
    if (sp !== -1 && sp < at) from = sp + 1;
  }
  if (to < text.length) {
    const sp = text.lastIndexOf(" ", to);
    if (sp > at + len) to = sp;
  }
  return {
    before: (from > 0 ? "…" : "") + text.slice(from, at),
    match: text.slice(at, at + len),
    after: text.slice(at + len, to) + (to < text.length ? "…" : ""),
  };
}

/** Every line that contains the phrase (at most `max`), in order. */
export function findInLines(lines: Line[], query: string, max = 3): LineHit[] {
  const q = foldQuery(query);
  if (q.length < 2) return [];
  const hits: LineHit[] = [];
  for (const l of lines) {
    const folded = foldChars(l.text).replace(/\s/g, " ");
    const at = folded.indexOf(q);
    if (at === -1) continue;
    hits.push({ start: l.start, speaker: l.speaker, snippet: snippetAround(l.text, at, q.length) });
    if (hits.length >= max) break;
  }
  return hits;
}

/** Lines of a transcript: the timestamped segments when there are any, else
 *  the plain memo split into its "Speaker: text" lines. */
export function linesOf(memo: string, segments: { start: number; speaker: string; text: string }[]): Line[] {
  if (segments.length) return segments.map((s) => ({ start: s.start, speaker: s.speaker, text: s.text }));
  return memo
    .split(/\n+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = /^([^:]{1,40}):\s+(.*)$/.exec(raw);
      return m ? { start: null, speaker: m[1], text: m[2] } : { start: null, speaker: "", text: raw };
    });
}
