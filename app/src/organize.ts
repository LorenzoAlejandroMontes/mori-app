import { db } from "./db";
import { answerLanguageNote, t } from "./i18n";
import { chatComplete, isLocalProvider, providerFor, RateLimited, tokensPerMinute, waitMsFor, type ProviderConfig } from "./llm";
import { indexSession, hasChunks } from "./index";
import { fixName, listTerms } from "./vocab";
import { parseSpeakerMap, relabelText } from "./speakers-logic";
import { isAutoTitle } from "./recording-logic";
import { cleanAssignee } from "./views/todo-logic";

// Mori "understands" a call: from its transcript it derives a summary,
// categories (auto-tags), durable memories, and a light entity/commitment/
// decision graph — writing them to the DB. Auto output NEVER overwrites what the
// user set by hand (Rule Zero-D).

type Extraction = {
  title?: string;
  summary: string;
  actions?: { text: string; assignee?: string | null; due?: string | null }[];
  categories: { name: string; kind: string }[];
  memories: {
    content: string;
    kind: string;
    subject_type: string;
    subject_id?: string | null;
  }[];
  // New in Phase B — all optional so the type stays tolerant of older/short outputs.
  entities?: { kind: string; name: string }[];
  commitments?: {
    who?: string | null;
    to_whom?: string | null;
    what: string;
    due?: string | null;
    quote?: string | null;
  }[];
  decisions?: { what: string; figures?: string | null; quote?: string | null }[];
};

// --- pure helpers (covered by scripts/checks.mjs) ----------------------------

/** How many actions/memories a call of this length may produce. The old prompt
 *  said "Max 5" and measured proof it bit: all 7 organized calls had EXACTLY 5,
 *  the 90-minute one included. Now it scales: ~5 per quarter of an hour. */
export function actionCap(minutes: number): number {
  const scaled = Math.ceil(Math.max(minutes, 1) / 15) * 5;
  return Math.min(Math.max(scaled, 5), 25);
}

/** Comparison key for "is this the same action/memory?": lowercase, no accents,
 *  no punctuation, single spaces. Keeps a re-organize from duplicating rows. */
export function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WEEKDAYS: Record<string, number> = {
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
};
const MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmtISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

// The call's own day, in UTC so the arithmetic never drifts with the timezone.
function baseDate(iso: string | null | undefined): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = iso ? new Date(iso) : new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Turn what was said ("giovedì", "domani", "entro fine mese") into a real date,
 *  relative to the day of the call. Returns an ISO `YYYY-MM-DD`, or the original
 *  phrase when it cannot be resolved (better a phrase than a wrong date), or null.
 *  Measured motive: due_at in the real DB held "giovedì", "domani", "lunedì",
 *  "prossima settimana" and a 2024 date — none of them usable. */
export function resolveDue(raw: string | null | undefined, callIso: string | null | undefined): string | null {
  const original = (raw ?? "").trim();
  if (!original) return null;
  // Models sometimes answer the string "null" instead of JSON null (seen live on a recovered call).
  if (/^(null|none|n\/a|nessuna|-)$/i.test(original)) return null;

  // Already a date (with or without a time): keep the date part.
  const isoHit = /^(\d{4}-\d{2}-\d{2})/.exec(original);
  if (isoHit) return isoHit[1];

  const base = baseDate(callIso);
  const s = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/\boggi\b|\bstasera\b|\bstamattina\b|\bin giornata\b/.test(s)) return fmtISO(base);
  if (/\bdopodomani\b/.test(s)) return fmtISO(addDays(base, 2));
  if (/\bdomani\b/.test(s)) return fmtISO(addDays(base, 1));

  const inDays = /\b(?:tra|fra|entro) (\d+) giorn/.exec(s);
  if (inDays) return fmtISO(addDays(base, +inDays[1]));
  const inWeeks = /\b(?:tra|fra|entro) (\d+) settiman/.exec(s);
  if (inWeeks) return fmtISO(addDays(base, 7 * +inWeeks[1]));
  if (/\b(?:tra|fra) (?:una|1) settimana\b/.test(s)) return fmtISO(addDays(base, 7));

  if (/\bfine (?:del )?mese\b/.test(s)) {
    return fmtISO(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
  }
  if (/\bfine (?:dell')?anno\b/.test(s)) {
    return fmtISO(new Date(Date.UTC(base.getUTCFullYear(), 11, 31)));
  }
  if (/\bfine settimana\b|\bweekend\b/.test(s)) return fmtISO(nextWeekday(base, 6));
  if (/\b(?:la )?(?:prossima settimana|settimana prossima)\b/.test(s)) return fmtISO(nextWeekday(base, 1));

  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(s)) return fmtISO(nextWeekday(base, dow));
  }

  // "il 2 ottobre", "2 ottobre 2026"
  const named = /\b(\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?: (\d{4}))?\b/.exec(s);
  if (named) {
    const year = named[3] ? +named[3] : base.getUTCFullYear();
    let d = new Date(Date.UTC(year, MONTHS[named[2]] - 1, +named[1]));
    if (!named[3] && d < base) d = new Date(Date.UTC(year + 1, MONTHS[named[2]] - 1, +named[1]));
    return fmtISO(d);
  }

  // "12/09", "12/09/2026" (day first, as spoken in Italian)
  const slash = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(s);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? 2000 + +slash[3] : +slash[3]) : base.getUTCFullYear();
    let d = new Date(Date.UTC(year, +slash[2] - 1, +slash[1]));
    if (!slash[3] && d < base) d = new Date(Date.UTC(year + 1, +slash[2] - 1, +slash[1]));
    return fmtISO(d);
  }

  return original; // not resolvable — keep what was actually said
}

// The next occurrence of a weekday STRICTLY after the call's day ("lunedì" said
// on a Monday means the Monday after, not today).
function nextWeekday(base: Date, dow: number): Date {
  const delta = (dow - base.getUTCDay() + 7) % 7;
  return addDays(base, delta === 0 ? 7 : delta);
}

const PROMPT = `Sei Mori: prendi appunti da una conversazione come farebbe un ottimo
product manager / chief of staff. NON un riassunto piatto: estrai ciò che serve per AGIRE.

Ragiona in quest'ordine prima di scrivere:
1. Qual era lo SCOPO della conversazione?
2. Cosa si è DECISO (scelte, numeri, accordi concreti)?
3. Cosa va FATTO: azioni concrete, con CHI le fa e ENTRO QUANDO se detto.
4. Cosa resta APERTO o da chiarire.

Restituisci SOLO un JSON valido, senza testo attorno, con questa forma esatta:
{
  "title": "titolo breve e specifico (max 6 parole), non generico",
  "summary": "markdown conciso e denso. Sezioni: '## Di cosa si è parlato' (2-4 punti), '## Decisioni' (solo se ci sono), '## Aperto' (solo se c'è). Vai al sodo, zero fuffa.",
  "actions": [{"text": "azione concreta e azionabile", "assignee": "nome o null", "due": "AAAA-MM-GG o null"}],
  "categories": [{"name": "categoria AMPIA e riutilizzabile (es. Prodotto, Clienti, Team, Admin, Personale)", "kind": "theme"}],
  "memories": [{"content": "fatto durevole in una frase", "kind": "fact|preference|commitment|open_question", "subject_type": "person|project|topic|general", "subject_id": "nome soggetto o null"}],
  "entities": [{"kind": "person|project|org|topic", "name": "nome proprio menzionato"}],
  "commitments": [{"who": "Tu|Nome", "to_whom": "Nome o null", "what": "cosa è stato promesso", "due": "scadenza o null", "quote": "frase originale breve dal testo"}],
  "decisions": [{"what": "cosa è stato deciso", "figures": "numeri/importi citati o null", "quote": "frase originale breve"}]
}

Regole ferree: in italiano, concreto e sintetico. Estrai SOLO ciò che è realmente
presente nel testo: MAI inventare nomi, date, numeri o impegni. Se una sezione non
ha contenuto, usa lista vuota o ometti la sezione nel summary. Le trascrizioni possono
avere errori: interpreta il senso, ma non aggiungere fatti non detti.
CATEGORIE: massimo 1-2, AMPIE e riutilizzabili (temi, non etichette specifiche). MAI usare
un nome di persona, cliente o progetto come categoria. Se una delle categorie già esistenti
(elencate sotto) calza, RIUSALA con lo stesso identico nome invece di crearne una nuova.
ENTITIES: solo nomi propri realmente citati (persone, progetti, organizzazioni, temi).
COMMITMENTS: solo impegni realmente presi; "who" = "Tu" quando è l'utente (voce al
microfono) a impegnarsi; "quote" DEVE essere una frase copiata dal testo. DECISIONS:
solo decisioni concrete; "quote" copiata dal testo. Se non ci sono, usa liste vuote.`;

// Length-aware tail of the prompt: the caps and, above all, the day the call
// happened — without it the model could only echo "giovedì" into due_at.
function limitsBlock(cap: number, callIso: string | null): string {
  const d = baseDate(callIso);
  const human = d.toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return `
LIMITI: massimo ${cap} azioni, ${cap} memorie, ${Math.min(cap, 12)} entità,
${Math.min(cap, 12)} impegni, ${Math.min(cap, 12)} decisioni. Non riempire per forza: meglio
poche voci vere che molte inventate, ma NON tagliare azioni realmente dette per stare stretto.
DATA DELLA CALL: ${human} (${fmtISO(d)}).
SCADENZE: "due" DEVE essere una data ISO AAAA-MM-GG calcolata a partire dalla data della call
("giovedì" = il primo giovedì successivo, "domani" = il giorno dopo, "fine mese" = l'ultimo del
mese). Se nessuna scadenza è stata detta, usa null. MAI inventare una scadenza.`;
}

// Map step of the map-reduce for long calls. It returns JSON — not prose — so the
// ACTIONS of every chunk survive the reduce step instead of being compressed away
// with the rest (that is how a 90-minute call still ended up with 5 to-dos).
const MAP_PROMPT = `Leggi questa PARTE di una conversazione e restituisci SOLO un JSON valido,
senza testo attorno, con questa forma:
{"punti": ["punto conciso e concreto: decisioni, fatti importanti, domande aperte"],
 "azioni": [{"text": "cosa va fatto", "assignee": "nome o null", "due": "scadenza detta o null"}]}
In italiano. Non inventare nulla: solo ciò che è realmente detto in QUESTA parte.
Metti in "azioni" ogni cosa da fare citata qui, anche piccola.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const approxTokens = (s: string) => Math.ceil(s.length / 3.5);
const FIT = 5500; // safe input size under the free-tier ~8000 tokens/minute limit

/** How much transcript fits in ONE request: 5500 tokens under the worst free
 *  tier, more when the provider has told us its per-minute budget is bigger
 *  (then a whole long call goes in one pass instead of three, plus the waits). */
export function fitTokens(tpm: number | null, local: boolean): number {
  if (local || !tpm) return FIT;
  return Math.max(FIT, Math.min(24_000, Math.floor(tpm * 0.55)));
}

// --- what "understanding" is doing right now -----------------------------------
// A long call on a free tier is several requests and some waiting: the views
// show which piece Mori is on and, when the provider asks for a pause, for how
// long — instead of a bare "Sto capendo…" for minutes (src/progress.ts).

export type Understanding = {
  sessionId: string;
  /** 0-based request being made, out of `steps` (the pieces, then the whole). */
  step: number;
  steps: number;
  /** Epoch ms until which Mori waits for the provider's per-minute budget. */
  waitUntil: number | null;
};

let _und: Understanding | null = null;
const undListeners = new Set<() => void>();

export function understandingNow(): Understanding | null {
  return _und;
}

export function subscribeUnderstanding(cb: () => void): () => void {
  undListeners.add(cb);
  return () => {
    undListeners.delete(cb);
  };
}

function setUnd(next: Understanding | null) {
  _und = next;
  for (const cb of [...undListeners]) {
    try {
      cb();
    } catch {
      /* a broken view must not break organize */
    }
  }
}

/** Pause, and let the views count it down. */
async function pause(ms: number) {
  if (ms <= 0) return;
  if (_und) setUnd({ ..._und, waitUntil: Date.now() + ms });
  await sleep(ms);
  if (_und) setUnd({ ..._und, waitUntil: null });
}

// Retry after a rate/size error, waiting as long as the provider asked (it says
// so in the 429) rather than a blind minute.
async function llmRetry(
  messages: Parameters<typeof chatComplete>[0],
  cfg: ProviderConfig,
  json = false,
): Promise<string> {
  const opts = { json, effort: "low" as const };
  for (let attempt = 0; ; attempt++) {
    try {
      await pause(waitMsFor(cfg, approxTokens(messages.map((m) => m.content).join("")) + 1500));
      return await chatComplete(messages, cfg, opts);
    } catch (e) {
      if (attempt < 2 && e instanceof RateLimited) {
        await pause(e.waitMs);
        continue;
      }
      if (attempt < 1 && /\b413\b|rate|too large|per minute|TPM/i.test(String(e))) {
        await pause(20000);
        continue;
      }
      throw e;
    }
  }
}

/** On Groq's free tier each model has its own per-minute budget, and
 *  gpt-oss-20b runs about twice as fast as the 120b: the pieces of a long call
 *  (short notes and to-dos, not the final judgement) go to the 20b, the final
 *  pass stays on the model the user chose. Anywhere else: the same model. */
export function mapModelFor(cfg: ProviderConfig): ProviderConfig {
  try {
    if (new URL(cfg.baseUrl.trim()).hostname === "api.groq.com" && cfg.model.trim() === "openai/gpt-oss-120b") {
      return { ...cfg, model: "openai/gpt-oss-20b" };
    }
  } catch {
    /* not a URL: same model */
  }
  return cfg;
}

/** A piece on the faster model; if that model is gone (renamed, retired) or
 *  refuses, the piece goes to the main one — never lost. */
async function mapCall(messages: Parameters<typeof chatComplete>[0], cfg: ProviderConfig): Promise<string> {
  const fast = mapModelFor(cfg);
  if (fast === cfg) return llmRetry(messages, cfg, true);
  try {
    return await llmRetry(messages, fast, true);
  } catch (e) {
    if (e instanceof RateLimited) throw e;
    return llmRetry(messages, cfg, true);
  }
}

type Action = { text: string; assignee?: string | null; due?: string | null };

// Long calls exceed the free-tier per-request limit. Map-reduce: summarize each
// chunk (paced under the limit), then work from the combined summaries — but
// carry every chunk's ACTIONS out separately, so the reduce step can compress
// the prose without silently dropping things to do.
async function condense(
  transcript: string,
  cfg: ProviderConfig,
): Promise<{ text: string; actions: Action[] }> {
  const fit = fitTokens(tokensPerMinute(cfg), isLocalProvider(cfg));
  if (approxTokens(transcript) <= fit) return { text: transcript, actions: [] };
  // ~4000 tokens a piece under the worst free tier, bigger when there is room.
  const size = Math.max(14000, Math.floor(fit * 3.5 * 0.75));
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += size) chunks.push(transcript.slice(i, i + size));

  const parts: string[] = [];
  const actions: Action[] = [];
  // The pieces, then the final pass (and maybe a compression in between).
  if (_und) setUnd({ ..._und, step: 0, steps: chunks.length + 1 });
  for (let i = 0; i < chunks.length; i++) {
    if (_und) setUnd({ ..._und, step: i });
    // Paced by llmRetry from the provider's own budget, not a fixed sleep.
    const raw = await mapCall(
      [
        { role: "system", content: MAP_PROMPT + answerLanguageNote() },
        { role: "user", content: `Parte ${i + 1}/${chunks.length}:\n${chunks[i]}` },
      ],
      cfg,
    );
    try {
      const j = JSON.parse(sliceJson(raw)) as { punti?: unknown[]; azioni?: Action[] };
      const punti = (j.punti ?? []).map((p) => (typeof p === "string" ? `- ${p}` : "")).filter(Boolean);
      parts.push(punti.join("\n"));
      for (const a of j.azioni ?? []) if (a?.text?.trim()) actions.push(a);
    } catch {
      parts.push(raw); // model answered in prose: keep it, we lose only the split-out actions
    }
  }

  let condensed = parts.filter(Boolean).join("\n\n");
  if (approxTokens(condensed) > fit) {
    if (_und) setUnd({ ..._und, step: chunks.length, steps: chunks.length + 2 });
    // Second pass compresses the prose only — `actions` is already safe in hand.
    condensed = await llmRetry(
      [
        { role: "system", content: "Comprimi questi appunti in punti puntati, in italiano, senza perdere fatti, decisioni e numeri. Nessun preambolo." + answerLanguageNote() },
        { role: "user", content: condensed },
      ],
      cfg,
    );
  }
  return { text: condensed, actions };
}

function sliceJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(t("Risposta non in formato JSON"));
  return raw.slice(start, end + 1);
}

function parseJson(raw: string): Extraction {
  return JSON.parse(sliceJson(raw));
}

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

/** How long the call actually was, in minutes. Best source is the last
 *  timestamped segment; otherwise the transcript's length (measured on the real
 *  calls: ~430 characters of Italian speech per minute). */
async function callMinutes(sessionId: string, memoLength: number): Promise<number> {
  const d = await db();
  const [row] = await d.select<{ last_end: number | null }[]>(
    `SELECT MAX(end_sec) last_end FROM transcript_chunk WHERE session_id = $1`,
    [sessionId],
  );
  if (row?.last_end && row.last_end > 60) return row.last_end / 60;
  const [tr] = await d.select<{ segments_json: string | null }[]>(
    `SELECT segments_json FROM session_transcript WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );
  if (tr?.segments_json) {
    try {
      const segs = JSON.parse(tr.segments_json) as { end?: number }[];
      const end = segs.length ? segs[segs.length - 1]?.end : 0;
      if (end && end > 60) return end / 60;
    } catch {
      /* fall through to the character estimate */
    }
  }
  return Math.max(1, memoLength / 430);
}

/** `cfgOverride` is the provider the queue already chose for this call (a
 *  private call gets the local one); without it the privacy rule is applied here. */
export async function organizeSession(sessionId: string, cfgOverride?: ProviderConfig): Promise<Extraction> {
  setUnd({ sessionId, step: 0, steps: 1, waitUntil: null });
  try {
    return await organizeOnce(sessionId, cfgOverride);
  } finally {
    setUnd(null);
  }
}

async function organizeOnce(sessionId: string, cfgOverride?: ProviderConfig): Promise<Extraction> {
  const d = await db();
  const [meta] = await d.select<
    { title: string; started_at: string | null; sensitive: number | null; metadata_json: string | null }[]
  >(`SELECT title, started_at, sensitive, metadata_json FROM session WHERE id = $1`, [sessionId]);
  const sensitive = (meta?.sensitive ?? 0) === 1;
  const cfg = cfgOverride ?? providerFor(sensitive);
  if (!cfg) {
    throw new Error(
      sensitive
        ? t("Call privata: serve un modello locale (Impostazioni → Modello).")
        : t("Imposta il modello (Impostazioni → Modello) prima di far organizzare Mori."),
    );
  }
  // Belt and braces: whoever passed the provider, a private call never leaves the PC.
  if (sensitive && !isLocalProvider(cfg)) throw new Error(t("Call privata: non la mando a un modello in cloud."));
  await listTerms(); // the name dictionary must be loaded before we write any name

  const parts = await d.select<{ display_name: string }[]>(
    `SELECT display_name FROM session_participant WHERE session_id = $1`,
    [sessionId],
  );
  const [tr] = await d.select<{ memo: string }[]>(
    `SELECT memo FROM session_transcript WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );

  const existingCats = await categoryNames(isLocalProvider(cfg));

  // "Interlocutore:" lines carry the name the user gave, so the model can tell
  // WHO promised what instead of guessing.
  const memo = relabelText(tr?.memo ?? "", parseSpeakerMap(meta?.metadata_json));
  const minutes = await callMinutes(sessionId, memo.length);
  const cap = actionCap(minutes);
  const callDate = meta?.started_at ?? null;

  const { text: transcript, actions: chunkActions } = await condense(memo, cfg);
  if (_und) setUnd({ ..._und, step: _und.steps - 1 });
  const convo = `Titolo: ${meta?.title ?? ""}
Partecipanti: ${parts.map((p) => p.display_name).join(", ")}
Categorie già esistenti (riusale se calzano): ${existingCats.map((c) => c.name).join(", ") || "nessuna"}
Durata della call: ${Math.round(minutes)} minuti
Trascritto: ${transcript}`;

  const raw = await llmRetry(
    [
      { role: "system", content: PROMPT + limitsBlock(cap, callDate) + answerLanguageNote() },
      { role: "user", content: convo },
    ],
    cfg,
    true,
  );
  const ext = parseJson(raw);

  // Actions found chunk by chunk are merged in FIRST: they come straight from the
  // transcript, while the final pass only ever saw the condensed version.
  const mergedActions: Action[] = [];
  const seenAction = new Set<string>();
  for (const a of [...chunkActions, ...(ext.actions ?? [])]) {
    const text = a?.text?.trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || seenAction.has(key)) continue;
    seenAction.add(key);
    mergedActions.push(a);
    if (mergedActions.length >= cap) break;
  }
  ext.actions = mergedActions;

  // 0) Title — replace ONLY a generic auto title, never one the user chose (Rule Zero-D).
  const currentTitle = meta?.title ?? "";
  const isGeneric = isAutoTitle(currentTitle);
  if (ext.title?.trim() && isGeneric) {
    await d.execute(`UPDATE session SET title = $1, updated_at = $2 WHERE id = $3`, [
      ext.title.trim(),
      now(),
      sessionId,
    ]);
  }

  // 1) Summary — insert when there is none; on a re-organize, refresh ONLY a
  // summary Mori wrote itself (source='auto'). A pre-existing one (source NULL)
  // or anything the user touched is never overwritten (Rule Zero-D).
  const [existingSummary] = await d.select<{ id: string; source: string | null }[]>(
    `SELECT id, source FROM session_document
      WHERE session_id = $1 AND kind = 'summary' ORDER BY created_at LIMIT 1`,
    [sessionId],
  );
  if (ext.summary?.trim()) {
    if (!existingSummary) {
      await d.execute(
        `INSERT INTO session_document (id, session_id, kind, title, body, body_format, source, created_at, updated_at)
         VALUES ($1, $2, 'summary', 'Sintesi', $3, 'markdown', 'auto', $4, $4)`,
        [uid(), sessionId, ext.summary.trim(), now()],
      );
    } else if (existingSummary.source === "auto") {
      await d.execute(`UPDATE session_document SET body = $1, updated_at = $2 WHERE id = $3`, [
        ext.summary.trim(),
        now(),
        existingSummary.id,
      ]);
    }
  }

  // 2) Categories — reuse existing by name; auto-link only if no link exists yet.
  for (const c of ext.categories ?? []) {
    const name = c.name?.trim();
    if (!name) continue;
    let [cat] = await d.select<{ id: string }[]>(
      `SELECT id FROM category WHERE lower(name) = lower($1) LIMIT 1`,
      [name],
    );
    if (!cat) {
      const id = uid();
      await d.execute(
        `INSERT INTO category (id, name, color, kind, source, created_at)
         VALUES ($1, $2, NULL, $3, 'auto', $4)`,
        [id, name, c.kind ?? "custom", now()],
      );
      cat = { id };
    }
    await d.execute(
      `INSERT OR IGNORE INTO session_category (session_id, category_id, confidence, source, created_at)
       VALUES ($1, $2, 0.8, 'auto', $3)`,
      [sessionId, cat.id, now()],
    );
  }

  // 3) Memories — skip duplicates. Compared on the NORMALIZED text (accents and
  // punctuation removed), so a re-organize with slightly different wording does
  // not stack near-identical facts.
  const existingMems = await d.select<{ content: string }[]>(
    `SELECT mm.content FROM memory mm
       JOIN memory_link ml ON ml.memory_id = mm.id
      WHERE ml.session_id = $1`,
    [sessionId],
  );
  const memKeys = new Set(existingMems.map((m) => normalizeText(m.content)));
  for (const m of (ext.memories ?? []).slice(0, cap)) {
    const content = m.content?.trim();
    if (!content) continue;
    const key = normalizeText(content);
    if (!key || memKeys.has(key)) continue;
    memKeys.add(key);
    const id = uid();
    await d.execute(
      `INSERT INTO memory (id, subject_type, subject_id, content, kind, confidence, status, source_session_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0.8, 'active', $6, $7, $7)`,
      [
        id,
        m.subject_type ?? "general",
        m.subject_id ? fixName(m.subject_id) : null,
        content,
        m.kind ?? "fact",
        sessionId,
        now(),
      ],
    );
    await d.execute(`INSERT INTO memory_link (memory_id, session_id) VALUES ($1, $2)`, [id, sessionId]);
  }

  // 4) Action items — feed the to-do system. Dedup on the normalized text; when
  // the action already exists we only FILL what was missing (a due date we can
  // now resolve, an assignee), never overwrite a value that is already there.
  const existingActions = await d.select<{ id: string; text: string; assignee: string | null; due_at: string | null }[]>(
    `SELECT id, text, assignee, due_at FROM session_action_item WHERE session_id = $1`,
    [sessionId],
  );
  const actionByKey = new Map(existingActions.map((a) => [normalizeText(a.text), a]));
  for (const a of ext.actions ?? []) {
    const text = a.text?.trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (!key) continue;
    const due = resolveDue(a.due, callDate);
    const who = cleanAssignee(a.assignee);
    const assignee = who ? fixName(who) : null;
    const dup = actionByKey.get(key);
    if (dup) {
      if (!dup.due_at && due) await d.execute(`UPDATE session_action_item SET due_at = $1 WHERE id = $2`, [due, dup.id]);
      if (!dup.assignee && assignee)
        await d.execute(`UPDATE session_action_item SET assignee = $1 WHERE id = $2`, [assignee, dup.id]);
      continue;
    }
    const id = uid();
    await d.execute(
      `INSERT INTO session_action_item (id, session_id, text, assignee, status, due_at, created_at)
       VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
      [id, sessionId, text, assignee, due, now()],
    );
    actionByKey.set(key, { id, text, assignee, due_at: due });
  }

  // 5) Entity/commitment/decision graph (Phase B).
  // Make sure the session is chunked first: it gives us timestamps to locate a
  // quote's position in the call, and satisfies the "index if missing" fallback.
  if (!(await hasChunks(sessionId))) {
    try {
      await indexSession(sessionId);
    } catch {
      /* best-effort; start_sec just stays null if we couldn't chunk */
    }
  }
  const chunks = await d.select<{ start_sec: number | null; text: string }[]>(
    `SELECT start_sec, text FROM transcript_chunk WHERE session_id = $1 ORDER BY idx`,
    [sessionId],
  );
  // Best-effort: the start of the chunk whose text contains the quote's opening.
  const locate = (quote?: string | null): number | null => {
    const q = (quote ?? "").trim().toLowerCase().slice(0, 30);
    if (q.length < 6) return null;
    for (const c of chunks) {
      if (c.text.toLowerCase().includes(q)) return c.start_sec;
    }
    return null;
  };

  // Re-derive this session's links/commitments/decisions cleanly (idempotent on
  // re-organize). Entities themselves persist and are shared across sessions.
  await d.execute(`DELETE FROM session_entity WHERE session_id = $1`, [sessionId]);
  await d.execute(`DELETE FROM commitment WHERE session_id = $1`, [sessionId]);
  await d.execute(`DELETE FROM decision WHERE session_id = $1`, [sessionId]);

  const graphCap = Math.min(cap, 12);
  const ALLOWED_KINDS = new Set(["person", "project", "org", "topic"]);
  for (const e of (ext.entities ?? []).slice(0, graphCap)) {
    // The name dictionary applies HERE, at write time: "Alenso" becomes "Lorenzo"
    // before it ever becomes an entity.
    const name = fixName(e.name);
    const kind = (e.kind ?? "topic").trim().toLowerCase();
    if (!name || !ALLOWED_KINDS.has(kind)) continue;
    let [row] = await d.select<{ id: string }[]>(
      `SELECT id FROM entity WHERE kind = $1 AND lower(name) = lower($2) LIMIT 1`,
      [kind, name],
    );
    if (!row) {
      const id = uid();
      await d.execute(
        `INSERT OR IGNORE INTO entity (id, kind, name, created_at) VALUES ($1, $2, $3, $4)`,
        [id, kind, name, now()],
      );
      [row] = await d.select<{ id: string }[]>(
        `SELECT id FROM entity WHERE kind = $1 AND lower(name) = lower($2) LIMIT 1`,
        [kind, name],
      );
    }
    if (row) {
      await d.execute(
        `INSERT OR IGNORE INTO session_entity (session_id, entity_id) VALUES ($1, $2)`,
        [sessionId, row.id],
      );
    }
  }

  for (const c of (ext.commitments ?? []).slice(0, graphCap)) {
    const what = c.what?.trim();
    if (!what) continue;
    await d.execute(
      `INSERT INTO commitment (id, session_id, who, to_whom, what, due, status, quote, start_sec, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)`,
      [
        uid(),
        sessionId,
        cleanAssignee(c.who) ? fixName(c.who) : null,
        cleanAssignee(c.to_whom) ? fixName(c.to_whom) : null,
        what,
        resolveDue(c.due, callDate),
        c.quote ?? null,
        locate(c.quote),
        now(),
      ],
    );
  }

  for (const dec of (ext.decisions ?? []).slice(0, graphCap)) {
    const what = dec.what?.trim();
    if (!what) continue;
    await d.execute(
      `INSERT INTO decision (id, session_id, what, figures, quote, start_sec, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid(), sessionId, what, dec.figures ?? null, dec.quote ?? null, locate(dec.quote), now()],
    );
  }

  return ext;
}

const RECAT_PROMPT = `Assegna a questa call 1-2 CATEGORIE ampie e riutilizzabili: temi generali
(es. Prodotto, Clienti, Team, Admin, Personale, Ricerca). MAI usare un nome di persona, cliente
o progetto specifico come categoria. Se una delle categorie già esistenti calza, RIUSALA con lo
stesso identico nome. Restituisci SOLO JSON, senza testo attorno: {"categories":["Nome","Nome"]}`;

// Re-derive broad, reusable categories for every call and REPLACE the old links,
// then drop categories that no longer point at anything (cleans up the noisy
// person/project tags created before the taxonomy was tightened). Paced for
// free-tier token limits; uses the short summary as input, not the full transcript.
export async function recategorizeAllSessions(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const d = await db();
  if (!providerFor(false) && !providerFor(true)) throw new Error(t("Imposta il modello (Impostazioni → Modello) prima di riorganizzare."));

  const sessions = await d.select<{ id: string; title: string; sensitive: number | null }[]>(
    `SELECT id, title, sensitive FROM session ORDER BY COALESCE(started_at, created_at) DESC`,
  );

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    // Each call goes to the model it is allowed to reach; a private call with
    // no local model keeps the categories it has.
    const cfg = providerFor((s.sensitive ?? 0) === 1);
    if (!cfg) {
      onProgress?.(i + 1, sessions.length);
      continue;
    }
    const [sum] = await d.select<{ body: string }[]>(
      `SELECT body FROM session_document WHERE session_id = $1 AND kind = 'summary' LIMIT 1`,
      [s.id],
    );
    const [tr] = await d.select<{ memo: string }[]>(
      `SELECT memo FROM session_transcript WHERE session_id = $1 LIMIT 1`,
      [s.id],
    );
    const parts = await d.select<{ display_name: string }[]>(
      `SELECT display_name FROM session_participant WHERE session_id = $1`,
      [s.id],
    );
    const basis = (sum?.body?.trim() || (tr?.memo ?? "").slice(0, 4000)).trim();
    if (!basis && !s.title) {
      onProgress?.(i + 1, sessions.length);
      continue;
    }

    const existingCats = await categoryNames(isLocalProvider(cfg));
    const input = `Titolo: ${s.title}
Partecipanti: ${parts.map((p) => p.display_name).join(", ")}
Categorie già esistenti (riusa se calzano): ${existingCats.map((c) => c.name).join(", ") || "nessuna"}
Contenuto: ${basis}`;

    let names: string[] = [];
    try {
      const raw = await llmRetry(
        [{ role: "system", content: RECAT_PROMPT }, { role: "user", content: input }],
        cfg,
        true,
      );
      const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      names = (j.categories ?? [])
        .map((x: unknown) => (typeof x === "string" ? x : (x as { name?: string })?.name))
        .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
        .slice(0, 2);
    } catch {
      names = []; // leave this call's categories untouched on a parse/LLM failure
    }

    if (names.length) {
      await d.execute(`DELETE FROM session_category WHERE session_id = $1`, [s.id]);
      for (const raw of names) {
        const name = raw.trim();
        let [cat] = await d.select<{ id: string }[]>(
          `SELECT id FROM category WHERE lower(name) = lower($1) LIMIT 1`,
          [name],
        );
        if (!cat) {
          const id = uid();
          await d.execute(
            `INSERT INTO category (id, name, color, kind, source, created_at)
             VALUES ($1, $2, NULL, 'theme', 'auto', $3)`,
            [id, name, now()],
          );
          cat = { id };
        }
        await d.execute(
          `INSERT OR IGNORE INTO session_category (session_id, category_id, confidence, source, created_at)
           VALUES ($1, $2, 0.8, 'auto', $3)`,
          [s.id, cat.id, now()],
        );
      }
    }

    onProgress?.(i + 1, sessions.length);
    if (i < sessions.length - 1) await sleep(1200); // light pacing under TPM limits
  }

  // Drop categories that no longer point at any call (old person/project tags).
  await d.execute(
    `DELETE FROM category WHERE id NOT IN (SELECT category_id FROM session_category)`,
  );
}

/** The categories the model may see, to reuse them. A cloud model only gets
 *  the ones used by a non-private call (or created by hand, unused): a name a
 *  local model drew from a private call is derived content too. */
async function categoryNames(local: boolean): Promise<{ name: string }[]> {
  const d = await db();
  if (local) return d.select<{ name: string }[]>(`SELECT DISTINCT name FROM category ORDER BY name`);
  return d.select<{ name: string }[]>(
    `SELECT DISTINCT c.name FROM category c
      WHERE NOT EXISTS (SELECT 1 FROM session_category sc WHERE sc.category_id = c.id)
         OR EXISTS (SELECT 1 FROM session_category sc JOIN session s ON s.id = sc.session_id
                     WHERE sc.category_id = c.id AND COALESCE(s.sensitive, 0) = 0)
      ORDER BY c.name`,
  );
}

// True if Mori has already understood this session (has a summary).
export async function isOrganized(sessionId: string): Promise<boolean> {
  const d = await db();
  const [row] = await d.select<{ n: number }[]>(
    `SELECT COUNT(*) n FROM session_document WHERE session_id = $1 AND kind = 'summary'`,
    [sessionId],
  );
  return (row?.n ?? 0) > 0;
}
