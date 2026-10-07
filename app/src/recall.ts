import { db, privateSessionIds } from "./db";
import { embed, cosine } from "./embeddings";
import { chunkSignature } from "./index";
import { locale, t } from "./i18n";

// A source shown under a chat answer. `start` (seconds) is the best-matching
// chunk's position in the call, when known — the UI can offer a "▶ mm:ss" chip.
export type Source = { id: string; title: string; date: string; start?: number | null };

export type RetrieveOptions = {
  /** May private calls be read? Only when the model answering runs on this
   *  machine (DECISIONS.md, rule 3). Default: no. */
  includePrivate?: boolean;
};

export type Retrieved = {
  context: string;
  sources: Source[];
  /** How many private calls were kept out of the context (0 when allowed). */
  excludedPrivate: number;
  /** Every call whose material entered the context: chunks, facts, memories,
   *  to-dos. Saved with the answer, so it can be kept from a cloud model later. */
  usedSessions: string[];
};

type ChunkRow = {
  id: string;
  session_id: string;
  idx: number;
  start_sec: number | null;
  end_sec: number | null;
  speaker: string | null;
  text: string;
  embedding_json: string | null;
};

type MemRow = { content: string; source_session_id: string | null };
type TodoRow = {
  /** The call it comes from; null for one written by hand. */
  session_id: string | null;
  text: string;
  assignee: string | null;
  due_at: string | null;
  title: string;
  started_at: string | null;
  /** 1 = written by hand in "Da fare" (companion_todo), no call behind it. */
  manual: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" });
}

function fmtClock(sec: number | null): string {
  if (sec == null || !isFinite(sec)) return "";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

// Lowercase, strip accents, split on non-alphanumerics — shared by BM25 and the
// old term-overlap fallback so tokenization is consistent.
const STOP = new Set([
  // Italian
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra", "il", "lo", "la", "i", "gli", "le",
  "un", "uno", "una", "che", "chi", "cui", "non", "come", "dove", "quando", "cosa", "ho", "hai",
  "ha", "abbiamo", "avete", "hanno", "e", "ed", "o", "ma", "se", "al", "allo", "alla", "ai", "agli",
  "alle", "del", "dello", "della", "dei", "degli", "delle", "nel", "nella", "sul", "sulla", "si",
  "mi", "ti", "ci", "vi", "me", "te", "lui", "lei", "noi", "voi", "loro", "sono", "essere", "questo",
  "questa", "quello", "quella", "più", "molto", "anche", "già", "poi",
  // English
  "the", "a", "an", "of", "to", "in", "on", "for", "with", "and", "or", "but", "is", "are", "was",
  "were", "be", "been", "it", "this", "that", "what", "who", "when", "where", "how", "i", "you",
  "we", "they", "he", "she", "my", "your", "our",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Whole-word (accent/case-insensitive) presence of `name` in `hay`, so an entity
// like "Ada" doesn't match inside "strada".
function mentions(hay: string, name: string): boolean {
  const h = hay.toLowerCase();
  const n = name.toLowerCase();
  let from = 0;
  while (true) {
    const i = h.indexOf(n, from);
    if (i === -1) return false;
    const before = i === 0 ? "" : h[i - 1];
    const after = i + n.length >= h.length ? "" : h[i + n.length];
    const isLetter = (c: string) => /\p{L}|\p{N}/u.test(c);
    if (!isLetter(before) && !isLetter(after)) return true;
    from = i + n.length;
  }
}

// In-memory corpus (chunks + tokenization + vectors), rebuilt when the chunk
// count changes. Thousands of chunks × 384 dims is small enough to keep resident.
type Corpus = {
  signature: string;
  chunks: ChunkRow[];
  docs: string[][]; // tokenized chunk text
  df: Map<string, number>;
  avgdl: number;
  vectors: (Float32Array | null)[];
};
let _corpus: Corpus | null = null;

async function corpus(): Promise<Corpus> {
  const signature = await chunkSignature();
  if (_corpus && _corpus.signature === signature) return _corpus;
  const d = await db();
  const chunks = await d.select<ChunkRow[]>(
    `SELECT id, session_id, idx, start_sec, end_sec, speaker, text, embedding_json
       FROM transcript_chunk`,
  );
  const docs = chunks.map((c) => tokenize(c.text));
  const df = new Map<string, number>();
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgdl = docs.length ? docs.reduce((n, t) => n + t.length, 0) / docs.length : 0;
  const vectors = chunks.map((c) => {
    if (!c.embedding_json) return null;
    try {
      const arr = JSON.parse(c.embedding_json) as number[];
      return Float32Array.from(arr);
    } catch {
      return null;
    }
  });
  _corpus = { signature, chunks, docs, df, avgdl, vectors };
  return _corpus;
}

// BM25 scores for every doc (Robertson/Sparck-Jones idf, k1=1.2, b=0.75).
function bm25(queryTerms: string[], c: Corpus): number[] {
  const N = c.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const qt = [...new Set(queryTerms)];
  const idf = new Map<string, number>();
  for (const t of qt) {
    const df = c.df.get(t) ?? 0;
    idf.set(t, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }
  const scores = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    const dl = c.docs[i].length;
    if (!dl) continue;
    const tf = new Map<string, number>();
    for (const t of c.docs[i]) if (idf.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const [t, f] of tf) {
      const denom = f + k1 * (1 - b + (b * dl) / (c.avgdl || 1));
      s += (idf.get(t) ?? 0) * ((f * (k1 + 1)) / denom);
    }
    scores[i] = s;
  }
  return scores;
}

// Reciprocal-rank position map for the top `cap` docs of a scored list.
function rankMap(scores: number[], cap: number): Map<number, number> {
  const ranked = scores
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, cap);
  const m = new Map<number, number>();
  ranked.forEach((x, rank) => m.set(x.i, rank + 1)); // 1-based
  return m;
}

const CONTEXT_CAP = 12000;

// --- context budget ----------------------------------------------------------
// The old code glued every block together and cut the tail at CONTEXT_CAP.
// Measured: 12 chunks × ~1171 chars ≈ 14.000 > 12.000, and memories plus the 41
// open to-dos sat at the END — so exactly the things Mori is asked about were the
// things that got cut. Now each block has its own budget and the chunks (the big,
// compressible part) live on what is left.

export type ContextBlock = { kind: string; text: string; budget: number };

const BUDGET = {
  facts: 1600,
  memories: 1300,
  todos: 2400,
  todosWhenAsked: 5000,
};

/** Keep whole lines up to `room` characters; mark the cut when there is one. */
function clipToLines(text: string, room: number): string {
  if (room <= 0) return "";
  if (text.length <= room) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let used = 0;
  const marker = "\n[…]";
  const limit = Math.max(0, room - marker.length);
  for (const l of lines) {
    if (used + l.length + (out.length ? 1 : 0) > limit) break;
    used += l.length + (out.length ? 1 : 0);
    out.push(l);
  }
  if (!out.length) return text.slice(0, limit) + marker;
  return out.join("\n") + marker;
}

/** Fill each block up to its own budget; blocks with an infinite budget share
 *  whatever is left, in order. Never exceeds `cap`. */
export function packBlocks(blocks: ContextBlock[], cap: number): string {
  const texts = new Array<string>(blocks.length).fill("");
  const SEP = 2; // "\n\n"
  let spent = 0;

  blocks.forEach((b, i) => {
    if (!isFinite(b.budget) || !b.text.trim()) return;
    const t = clipToLines(b.text, Math.max(0, Math.min(b.budget, cap - spent)));
    if (t) {
      texts[i] = t;
      spent += t.length + SEP;
    }
  });
  blocks.forEach((b, i) => {
    if (isFinite(b.budget) || !b.text.trim()) return;
    const t = clipToLines(b.text, Math.max(0, cap - spent));
    if (t) {
      texts[i] = t;
      spent += t.length + SEP;
    }
  });

  return texts.filter(Boolean).join("\n\n");
}

/** "cosa devo fare?", "quali scadenze ho?" — the to-do block goes first and gets
 *  twice the room. */
export function isTodoQuestion(q: string): boolean {
  const s = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Two families: whole phrases, and stems that carry their own endings
  // ("scadenze", "scadenza", "impegni", "impegno").
  return (
    /\b(da fare|cosa devo|cosa dobbiamo|che devo|che dobbiamo|to.?do|azioni aperte|cose aperte|rimasto da|in sospeso|promesso)\b/.test(s) ||
    /\b(scadenz|impegn|scadut)/.test(s)
  );
}

const DAY = 86_400_000;
const isoDay = (s: string | null) => (/^\d{4}-\d{2}-\d{2}/.exec(s ?? "")?.[0] ?? null);

/** Rank the open to-dos instead of dumping all 41: what the question is about,
 *  what is due soon (or late), and what was said recently. */
function rankTodos(todos: TodoRow[], qTerms: string[], limit: number): TodoRow[] {
  const today = Date.now();
  const terms = new Set(qTerms);
  const scored = todos.map((t) => {
    const toks = new Set(tokenize(`${t.text} ${t.assignee ?? ""} ${t.title}`));
    let score = 0;
    for (const term of terms) if (toks.has(term)) score += 3;
    const due = isoDay(t.due_at);
    if (due) {
      const days = (Date.parse(due + "T00:00:00Z") - today) / DAY;
      score += days <= 0 ? 2.5 : days <= 7 ? 2 : days <= 30 ? 1.2 : 0.6;
    } else if (t.due_at) {
      score += 0.4; // a due nobody could resolve is still a signal of urgency
    }
    const started = t.started_at ? Date.parse(t.started_at) : NaN;
    if (!Number.isNaN(started)) score += Math.max(0, 1 - (today - started) / (120 * DAY));
    return { t, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Every open to-do Mori knows about: the ones pulled out of calls and the ones
 *  written by hand in "Da fare". For a hand-written one `started_at` is when it
 *  was added, so it ages in rankTodos like the others. */
async function openTodos(d: Awaited<ReturnType<typeof db>>): Promise<TodoRow[]> {
  const fromCalls = `SELECT ai.session_id, ai.text, ai.assignee, ai.due_at, s.title, s.started_at, 0 AS manual
       FROM session_action_item ai JOIN session s ON s.id = ai.session_id
      WHERE ai.status = 'open'`;
  try {
    return await d.select<TodoRow[]>(
      `${fromCalls}
     UNION ALL
     SELECT NULL AS session_id, text, assignee, due_at, '' AS title, created_at AS started_at, 1 AS manual
       FROM companion_todo
      WHERE status = 'open'`,
    );
  } catch {
    // companion_todo arrives with migration 0008: before it, only the calls.
    return d.select<TodoRow[]>(fromCalls);
  }
}

function todoLines(todos: TodoRow[]): string {
  return todos
    .map((t) => {
      const who = t.assignee ? ` (${t.assignee})` : "";
      const due = t.due_at ? ` — entro ${t.due_at}` : "";
      const when = t.started_at ? ` (${fmtDate(t.started_at)})` : "";
      const from = t.manual ? ` — aggiunta da te${when}` : ` — da: ${t.title}${when}`;
      return `- ${t.text}${who}${due}${from}`;
    })
    .join("\n");
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<Retrieved> {
  // Private calls stay out unless the answering model is local. Read fresh at
  // every question: a call marked private a second ago is already excluded.
  const priv = opts.includePrivate ? new Set<string>() : await privateSessionIds();
  const allowed = (sid: string | null | undefined) => !sid || !priv.has(sid);
  const excludedPrivate = priv.size;

  const c = await corpus();
  // Fresh DB / nothing indexed yet → keep the old term-overlap behavior.
  if (c.chunks.length === 0) return retrieveFallback(query, allowed, excludedPrivate);

  const d = await db();
  const qTerms = tokenize(query);
  // Scores of chunks from private calls are zeroed BEFORE ranking, so they can
  // neither appear nor push a readable chunk out of the top.
  const visible = c.chunks.map((ch) => allowed(ch.session_id));

  // 1) Lexical (BM25).
  const lex = bm25(qTerms, c).map((s, i) => (visible[i] ? s : 0));
  const lexRank = rankMap(lex, 50);

  // 2) Semantic (cosine on query embedding). Degrade to lexical-only on failure.
  const semRank = new Map<number, number>();
  try {
    // The embedder may be busy (indexing a long call, downloading the model on
    // first use): a question never waits for it more than a few seconds.
    const [qv] = await Promise.race([
      embed([query], "query"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("embedding lento")), 8000)),
    ]);
    if (qv) {
      const sims = c.vectors.map((v, i) => (v && visible[i] ? cosine(qv, v) : 0));
      for (const [i, r] of rankMap(sims, 50)) semRank.set(i, r);
    }
  } catch {
    /* lexical-only this turn */
  }

  // 3) RRF fusion.
  const K = 60;
  const rrf = new Map<number, number>();
  for (const [i, r] of lexRank) rrf.set(i, (rrf.get(i) ?? 0) + 1 / (K + r));
  for (const [i, r] of semRank) rrf.set(i, (rrf.get(i) ?? 0) + 1 / (K + r));

  // 4) Entity routing — which known entities does the query name?
  const entities = await d.select<{ id: string; name: string }[]>(`SELECT id, name FROM entity`);
  const hitEntities = entities.filter((e) => e.name.trim() && mentions(query, e.name.trim()));
  const boostedSessions = new Set<string>();
  if (hitEntities.length) {
    const ids = hitEntities.map((e) => e.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const links = await d.select<{ session_id: string }[]>(
      `SELECT DISTINCT session_id FROM session_entity WHERE entity_id IN (${placeholders})`,
      ids,
    );
    for (const l of links) if (allowed(l.session_id)) boostedSessions.add(l.session_id);
  }
  if (boostedSessions.size) {
    for (const [i, score] of rrf) {
      if (boostedSessions.has(c.chunks[i].session_id)) rrf.set(i, score * 1.3);
    }
  }

  // Top 12 fused chunks, at most 4 per session.
  const perSession = new Map<string, number>();
  const picked: number[] = [];
  for (const [i] of [...rrf.entries()].sort((a, b) => b[1] - a[1])) {
    const sid = c.chunks[i].session_id;
    const used = perSession.get(sid) ?? 0;
    if (used >= 4) continue;
    perSession.set(sid, used + 1);
    picked.push(i);
    if (picked.length >= 12) break;
  }

  // Session metadata for headers, sources, and structured facts.
  const meta = await d.select<{ id: string; title: string; started_at: string | null }[]>(
    `SELECT id, title, started_at FROM session`,
  );
  const metaById = new Map(meta.map((m) => [m.id, m]));

  // Order sessions by their best (highest-RRF) chunk.
  const bestBySession = new Map<string, number>();
  for (const i of picked) {
    const sid = c.chunks[i].session_id;
    const sc = rrf.get(i) ?? 0;
    if (sc > (bestBySession.get(sid) ?? -1)) bestBySession.set(sid, sc);
  }
  const sessionOrder = [...bestBySession.keys()].sort(
    (a, b) => (bestBySession.get(b) ?? 0) - (bestBySession.get(a) ?? 0),
  );

  // 5) Structured facts block (entity-routed commitments + decisions), first.
  let factsBlock = "";
  if (boostedSessions.size) {
    const ids = [...boostedSessions];
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    const commits = await d.select<{ who: string | null; to_whom: string | null; what: string; due: string | null; session_id: string }[]>(
      `SELECT who, to_whom, what, due, session_id FROM commitment
        WHERE session_id IN (${ph}) AND status = 'open' ORDER BY created_at DESC`,
      ids,
    );
    const decisions = await d.select<{ what: string; figures: string | null; session_id: string }[]>(
      `SELECT what, figures, session_id FROM decision
        WHERE session_id IN (${ph}) ORDER BY created_at DESC`,
      ids,
    );
    const facts: string[] = [];
    const src = (sid: string) => {
      const m = metaById.get(sid);
      return m ? `[${m.title} — ${fmtDate(m.started_at)}]` : "";
    };
    for (const c2 of commits) {
      if (facts.length >= 8) break;
      const who = c2.who ?? "";
      const to = c2.to_whom ? ` → ${c2.to_whom}` : "";
      const due = c2.due ? ` (entro ${c2.due})` : "";
      facts.push(`- Impegno: ${who}${to}: ${c2.what}${due} ${src(c2.session_id)}`.trim());
    }
    for (const dec of decisions) {
      if (facts.length >= 8) break;
      const fig = dec.figures ? ` (${dec.figures})` : "";
      facts.push(`- Decisione: ${dec.what}${fig} ${src(dec.session_id)}`.trim());
    }
    if (facts.length) factsBlock = `[Fatti strutturati]\n${facts.join("\n")}`;
  }

  // 6) Chunk context, grouped by session, chunks in time order.
  const chunkBlocks: string[] = [];
  for (const sid of sessionOrder) {
    const m = metaById.get(sid);
    const header = `[${m?.title ?? t("Call senza titolo")} — ${fmtDate(m?.started_at ?? null)}]`;
    const rows = picked
      .filter((i) => c.chunks[i].session_id === sid)
      .map((i) => c.chunks[i])
      .sort((a, b) => a.idx - b.idx);
    const body = rows
      .map((r) => {
        const clk = fmtClock(r.start_sec);
        const spk = r.speaker && r.speaker !== "misto" ? r.speaker : "";
        const tag = clk || spk ? `(${[clk, spk].filter(Boolean).join(", ")}) ` : "";
        return `${tag}${r.text}`;
      })
      .join("\n");
    chunkBlocks.push(`${header}\n${body}`);
  }

  // Relevant durable memories (term overlap) — cheap continuity with the old path.
  const mems = await d.select<MemRow[]>(
    `SELECT content, source_session_id FROM memory WHERE status = 'active'`,
  );
  const memMatch = mems
    .filter((mm) => allowed(mm.source_session_id))
    .filter((mm) => qTerms.some((t) => tokenize(mm.content).includes(t)))
    .slice(0, 8);
  const memBlock = memMatch.length
    ? `[Memoria di Mori]\n${memMatch.map((mm) => `- ${mm.content}`).join("\n")}`
    : "";

  // Open to-dos (from calls and written by hand), ranked (not all 41 of them)
  // and carrying their due date and where they come from.
  const askedTodos = isTodoQuestion(query);
  const todos = (await openTodos(d)).filter((t) => allowed(t.session_id));
  const pickedTodos = rankTodos(todos, qTerms, askedTodos ? 25 : 10);
  const todoBlock = pickedTodos.length ? `[Cose da fare ancora aperte]\n${todoLines(pickedTodos)}` : "";

  // Each block gets its own budget, so nothing that matters can be cut off the
  // end any more. When the question IS about to-dos, they lead and get more room.
  const todoBudget = askedTodos ? BUDGET.todosWhenAsked : BUDGET.todos;
  const ordered: ContextBlock[] = askedTodos
    ? [
        { kind: "todos", text: todoBlock, budget: todoBudget },
        { kind: "facts", text: factsBlock, budget: BUDGET.facts },
        { kind: "memories", text: memBlock, budget: BUDGET.memories },
        { kind: "chunks", text: chunkBlocks.join("\n\n"), budget: Infinity },
      ]
    : [
        { kind: "facts", text: factsBlock, budget: BUDGET.facts },
        { kind: "chunks", text: chunkBlocks.join("\n\n"), budget: Infinity },
        { kind: "memories", text: memBlock, budget: BUDGET.memories },
        { kind: "todos", text: todoBlock, budget: todoBudget },
      ];
  const context = packBlocks(ordered, CONTEXT_CAP);

  const sources: Source[] = sessionOrder.map((sid) => {
    const m = metaById.get(sid);
    // Earliest picked chunk with a timestamp → the "▶ mm:ss" seek target.
    const withTime = picked
      .filter((i) => c.chunks[i].session_id === sid && c.chunks[i].start_sec != null)
      .map((i) => c.chunks[i].start_sec as number)
      .sort((a, b) => a - b);
    return { id: sid, title: m?.title ?? t("Call senza titolo"), date: fmtDate(m?.started_at ?? null), start: withTime[0] ?? null };
  });

  const used = new Set<string>(sessionOrder);
  if (factsBlock) for (const sid of boostedSessions) used.add(sid);
  for (const mm of memMatch) if (mm.source_session_id) used.add(mm.source_session_id);
  for (const t of pickedTodos) if (t.session_id) used.add(t.session_id);

  return { context, sources, excludedPrivate, usedSessions: [...used] };
}

// --- Legacy fallback (fresh DB, nothing indexed) ----------------------------
// Naive term overlap over sessions → capped context. Kept so Mori isn't blind
// before any recording has been chunked/embedded.
async function retrieveFallback(
  query: string,
  allowed: (sid: string | null | undefined) => boolean,
  excludedPrivate: number,
): Promise<Retrieved> {
  const d = await db();
  const rows = (
    await d.select<{ id: string; title: string; started_at: string | null; docs: string | null; transcript: string | null }[]>(
      `SELECT s.id, s.title, s.started_at,
              (SELECT GROUP_CONCAT(body, '\n') FROM session_document WHERE session_id = s.id) AS docs,
              (SELECT memo FROM session_transcript WHERE session_id = s.id LIMIT 1) AS transcript
         FROM session s`,
    )
  ).filter((r) => allowed(r.id));

  const t = tokenize(query);
  const scored = rows
    .map((r) => {
      const hay = `${r.title} ${r.docs ?? ""} ${r.transcript ?? ""}`.toLowerCase();
      const score = t.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  let chosen = scored.map((x) => x.r);
  if (chosen.length === 0) {
    chosen = [...rows].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).slice(0, 2);
  }

  const mems = await d.select<MemRow[]>(
    `SELECT content, source_session_id FROM memory WHERE status = 'active'`,
  );
  const memMatch = mems
    .filter((m) => allowed(m.source_session_id))
    .filter((m) => t.some((term) => m.content.toLowerCase().includes(term)))
    .slice(0, 6);

  const sources: Source[] = chosen.map((r) => ({ id: r.id, title: r.title, date: fmtDate(r.started_at) }));

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() + " […]" : s);
  const notes = chosen
    .map((r) => {
      const summary = (r.docs ?? "").trim();
      const body = summary ? clip(summary, 1500) : clip((r.transcript ?? "").trim(), 1200);
      return `[${r.title} — ${fmtDate(r.started_at)}]\n${body}`;
    })
    .join("\n\n");

  const todos = (await openTodos(d)).filter((x) => allowed(x.session_id));
  const askedTodos = isTodoQuestion(query);
  const pickedTodos = rankTodos(todos, t, askedTodos ? 25 : 10);

  // Same per-block budget as the main path, so nothing gets cut off the end here
  // either (this is the fresh-DB path, but the rule must not differ).
  const context = packBlocks(
    [
      { kind: "chunks", text: notes, budget: Infinity },
      {
        kind: "memories",
        text: memMatch.length ? `[Memoria di Mori]\n${memMatch.map((m) => `- ${m.content}`).join("\n")}` : "",
        budget: BUDGET.memories,
      },
      {
        kind: "todos",
        text: pickedTodos.length ? `[Cose da fare ancora aperte]\n${todoLines(pickedTodos)}` : "",
        budget: askedTodos ? BUDGET.todosWhenAsked : BUDGET.todos,
      },
    ],
    CONTEXT_CAP,
  );
  const used = new Set<string>(chosen.map((r) => r.id));
  for (const m of memMatch) if (m.source_session_id) used.add(m.source_session_id);
  for (const x of pickedTodos) if (x.session_id) used.add(x.session_id);
  return { context, sources, excludedPrivate, usedSessions: [...used] };
}
