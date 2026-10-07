import { db } from "./db";

// The name dictionary. Whisper mangles the proper nouns of your world: an
// organization heard as "Fondazione Aurola" (for "Fondazione Aurora"),
// "Alenso" for "Lorenzo". One user-editable list fixes it in
// three places: as extra vocabulary for Whisper, as a replacement pass over a
// fresh transcript, and when organize writes entities/participants/assignees.
//
// It NEVER rewrites what is already in the DB on its own: that only happens when
// the user presses "Applica alle call esistenti", after seeing the row count.

export type VocabTerm = {
  id: string;
  wrong: string; // "" = a canonical name with nothing to correct (yet)
  correct: string;
  kind: string; // 'person' | 'project' | 'org' | 'term'
};

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

let _terms: VocabTerm[] | null = null;
let _matcher: { re: RegExp; by: Map<string, string> } | null = null;

export async function listTerms(): Promise<VocabTerm[]> {
  if (_terms) return _terms;
  return reload();
}

export async function reload(): Promise<VocabTerm[]> {
  const d = await db();
  _terms = await d.select<VocabTerm[]>(
    `SELECT id, wrong, correct, kind FROM vocab_term ORDER BY lower(correct), lower(wrong)`,
  );
  _matcher = null;
  return _terms;
}

/** Synchronous view of the dictionary, for hot paths that already loaded it. */
export function getTerms(): VocabTerm[] {
  return _terms ?? [];
}

export async function addTerm(t: { wrong?: string; correct: string; kind?: string }): Promise<void> {
  const correct = t.correct.trim();
  if (!correct) return;
  const wrong = (t.wrong ?? "").trim();
  const d = await db();
  // The unique index only covers rows WITH a wrong spelling, so a canonical-only
  // name would otherwise be addable twice.
  const [dup] = await d.select<{ id: string }[]>(
    `SELECT id FROM vocab_term WHERE lower(wrong) = lower($1) AND lower(correct) = lower($2) LIMIT 1`,
    [wrong, correct],
  );
  if (dup) return;
  await d.execute(
    `INSERT OR IGNORE INTO vocab_term (id, wrong, correct, kind, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [uid(), wrong, correct, t.kind ?? "person", now()],
  );
  await reload();
}

export async function updateTerm(id: string, t: { wrong: string; correct: string; kind: string }): Promise<void> {
  const correct = t.correct.trim();
  if (!correct) return;
  const d = await db();
  await d.execute(
    `UPDATE vocab_term SET wrong = $1, correct = $2, kind = $3, updated_at = $4 WHERE id = $5`,
    [t.wrong.trim(), correct, t.kind, now(), id],
  );
  await reload();
}

export async function deleteTerm(id: string): Promise<void> {
  const d = await db();
  await d.execute(`DELETE FROM vocab_term WHERE id = $1`, [id]);
  await reload();
}

/** Every canonical name, longest-known first — the Whisper vocabulary hint. */
export async function canonicalNames(): Promise<string[]> {
  const terms = await listTerms();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const k = t.correct.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.correct);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One alternation for the whole dictionary, longest term first so "Fondazione
// Aurola" wins over a shorter entry inside it. Whole words only (accented letters
// and digits count as word characters), case-insensitive.
function matcher(): { re: RegExp; by: Map<string, string> } | null {
  if (_matcher) return _matcher;
  const pairs = getTerms().filter((t) => t.wrong.trim());
  if (!pairs.length) return null;
  const sorted = [...pairs].sort((a, b) => b.wrong.length - a.wrong.length);
  const by = new Map<string, string>();
  for (const p of sorted) by.set(p.wrong.trim().toLowerCase(), p.correct);
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${sorted.map((p) => escapeRe(p.wrong.trim())).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  _matcher = { re, by };
  return _matcher;
}

/** Replace every known wrong spelling in a free text. Safe on empty dictionaries. */
export function applyVocab(text: string): string {
  const m = matcher();
  if (!m || !text) return text;
  m.re.lastIndex = 0;
  return text.replace(m.re, (hit) => m.by.get(hit.toLowerCase()) ?? hit);
}

/** Same, for a single name: trims, then corrects the whole name or part of it. */
export function fixName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return n;
  const m = matcher();
  if (!m) return n;
  const whole = m.by.get(n.toLowerCase());
  return whole ?? applyVocab(n);
}

/** Correct a transcript and its timestamped segments in one pass. */
export function applyVocabToSegments<T extends { text: string; speaker?: string }>(segments: T[]): T[] {
  const m = matcher();
  if (!m) return segments;
  return segments.map((s) => ({ ...s, text: applyVocab(s.text) }));
}

// --- explicit, user-triggered rewrite of existing rows ------------------------

export type VocabImpact = { entities: number; participants: number; assignees: number; total: number };

type Fix = { id: string; from: string; to: string; kind?: string };

async function plan(): Promise<{ entities: Fix[]; participants: Fix[]; assignees: Fix[] }> {
  const d = await db();
  await listTerms();
  const ents = await d.select<{ id: string; kind: string; name: string }[]>(`SELECT id, kind, name FROM entity`);
  const parts = await d.select<{ id: string; display_name: string }[]>(
    `SELECT id, display_name FROM session_participant`,
  );
  const acts = await d.select<{ id: string; assignee: string | null }[]>(
    `SELECT id, assignee FROM session_action_item WHERE assignee IS NOT NULL AND assignee <> ''`,
  );
  const keep = (from: string, to: string) => to !== from;
  return {
    entities: ents
      .map((e) => ({ id: e.id, from: e.name, to: fixName(e.name), kind: e.kind }))
      .filter((f) => keep(f.from, f.to)),
    participants: parts
      .map((p) => ({ id: p.id, from: p.display_name, to: fixName(p.display_name) }))
      .filter((f) => keep(f.from, f.to)),
    assignees: acts
      .map((a) => ({ id: a.id, from: a.assignee ?? "", to: fixName(a.assignee) }))
      .filter((f) => keep(f.from, f.to)),
  };
}

/** How many rows "Applica alle call esistenti" would touch — shown before doing it. */
export async function previewApplyToExisting(): Promise<VocabImpact> {
  const p = await plan();
  return {
    entities: p.entities.length,
    participants: p.participants.length,
    assignees: p.assignees.length,
    total: p.entities.length + p.participants.length + p.assignees.length,
  };
}

/** Rewrite ONLY entity names, participant names and assignees. Transcripts,
 *  summaries and anything the user typed are left alone. */
export async function applyToExisting(): Promise<VocabImpact> {
  const d = await db();
  const p = await plan();

  for (const f of p.entities) {
    // entity has a UNIQUE (kind, lower(name)): if the right name already exists,
    // merge the links into it instead of failing the update.
    const [dup] = await d.select<{ id: string }[]>(
      `SELECT id FROM entity WHERE kind = $1 AND lower(name) = lower($2) AND id <> $3 LIMIT 1`,
      [f.kind ?? "topic", f.to, f.id],
    );
    if (dup) {
      await d.execute(
        `INSERT OR IGNORE INTO session_entity (session_id, entity_id)
         SELECT session_id, $1 FROM session_entity WHERE entity_id = $2`,
        [dup.id, f.id],
      );
      await d.execute(`DELETE FROM entity WHERE id = $1`, [f.id]);
    } else {
      await d.execute(`UPDATE entity SET name = $1 WHERE id = $2`, [f.to, f.id]);
    }
  }
  for (const f of p.participants) {
    await d.execute(`UPDATE session_participant SET display_name = $1 WHERE id = $2`, [f.to, f.id]);
  }
  for (const f of p.assignees) {
    await d.execute(`UPDATE session_action_item SET assignee = $1 WHERE id = $2`, [f.to, f.id]);
  }

  return {
    entities: p.entities.length,
    participants: p.participants.length,
    assignees: p.assignees.length,
    total: p.entities.length + p.participants.length + p.assignees.length,
  };
}
