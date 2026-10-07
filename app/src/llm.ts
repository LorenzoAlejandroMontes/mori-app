import { fetch } from "@tauri-apps/plugin-http";
import { db } from "./db";
import { t } from "./i18n";

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const LEGACY_LS_KEY = "mori.provider"; // migrated into the DB, then ignored

// Default: Groq — free, fast, and does not train on your data (privacy stance).
// OpenAI-compatible, so you can later point baseUrl at LM Studio / Ollama / others.
const DEFAULT: ProviderConfig = {
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  // Groq production model (fast, good Italian). Swap in ⚙ for openai/gpt-oss-20b
  // (faster) or a local LM Studio/Ollama model.
  model: "openai/gpt-oss-120b",
};

// In-memory cache so getConfig() stays synchronous for callers. Populated by
// loadConfig() at startup; the source of truth is the SQLite `app_setting` table
// (persists across app launches and WebView profiles — unlike localStorage).
let _cache: ProviderConfig | null = null;

export async function loadConfig(): Promise<ProviderConfig> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>(
      "SELECT value FROM app_setting WHERE key = 'provider'",
    );
    if (rows[0]) {
      const loaded: ProviderConfig = { ...DEFAULT, ...JSON.parse(rows[0].value) };
      _cache = loaded;
      return loaded;
    }
    // One-time migration from the old localStorage store.
    try {
      const raw = localStorage.getItem(LEGACY_LS_KEY);
      if (raw) {
        const migrated = { ...DEFAULT, ...JSON.parse(raw) };
        await saveConfig(migrated);
        return migrated;
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  const fallback: ProviderConfig = { ...DEFAULT };
  _cache = fallback;
  return fallback;
}

export function getConfig(): ProviderConfig {
  return _cache ?? { ...DEFAULT };
}

export async function saveConfig(cfg: ProviderConfig): Promise<void> {
  _cache = cfg;
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ('provider', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
    [JSON.stringify(cfg)],
  );
}

// --- local vs cloud ----------------------------------------------------------
// A model running on this machine (LM Studio, Ollama, llama.cpp) needs no key,
// and nothing sent to it leaves the PC. Before this, every caller demanded an
// API key, so pointing Mori at LM Studio — the "solo locale" escape hatch of
// DECISIONS.md — left every call parked forever "waiting for a key".

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** True when the endpoint is on this machine. */
export function isLocalUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function isLocalProvider(cfg: ProviderConfig): boolean {
  return isLocalUrl(cfg.baseUrl);
}

/** Enough configuration to make a call: an endpoint, a model and — unless the
 *  model runs on this machine — a key. */
export function providerReady(cfg: ProviderConfig | null | undefined): boolean {
  if (!cfg) return false;
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) return false;
  return isLocalProvider(cfg) || !!cfg.apiKey.trim();
}

// The model allowed to read PRIVATE calls (session.sensitive = 1). DECISIONS.md,
// rule 3: a call marked sensitive goes only to a local LLM, never to the cloud.
// If the main provider is already local it is used; otherwise this one.
const LOCAL_DEFAULT: ProviderConfig = {
  baseUrl: "http://localhost:11434/v1", // Ollama's OpenAI-compatible endpoint
  apiKey: "",
  model: "",
};
let _localCache: ProviderConfig | null = null;

export async function loadLocalConfig(): Promise<ProviderConfig> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>(
      "SELECT value FROM app_setting WHERE key = 'provider_local'",
    );
    _localCache = rows[0] ? { ...LOCAL_DEFAULT, ...JSON.parse(rows[0].value) } : { ...LOCAL_DEFAULT };
  } catch {
    _localCache = { ...LOCAL_DEFAULT };
  }
  return _localCache as ProviderConfig;
}

export function getLocalConfig(): ProviderConfig {
  return _localCache ?? { ...LOCAL_DEFAULT };
}

export async function saveLocalConfig(cfg: ProviderConfig): Promise<void> {
  _localCache = cfg;
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ('provider_local', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
    [JSON.stringify(cfg)],
  );
}

/** The provider allowed to read a call, or null when none is (yet).
 *  Pure, so the privacy rule can be checked without the app. */
export function pickProvider(
  sensitive: boolean,
  main: ProviderConfig,
  local: ProviderConfig,
): ProviderConfig | null {
  if (!sensitive) return providerReady(main) ? main : null;
  if (isLocalProvider(main) && providerReady(main)) return main;
  return isLocalProvider(local) && providerReady(local) ? local : null;
}

/** Same, with the configuration currently loaded. */
export function providerFor(sensitive: boolean): ProviderConfig | null {
  return pickProvider(sensitive, getConfig(), getLocalConfig());
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = {
  /** Ask the provider to answer with a JSON object (OpenAI `response_format`). */
  json?: boolean;
  /** Give up after this long. The job runner is sequential: one request that
   *  never answers used to stall every transcription queued behind it. */
  timeoutMs?: number;
  /** For reasoning models: how much to think (sent only to models that take it). */
  effort?: "low" | "medium" | "high";
};

// Generous: a model writing a long JSON can take minutes — a local one on CPU
// many more. The point is only that "never" stops being a possible answer.
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const LOCAL_TIMEOUT_MS = 20 * 60_000;

// The base URL is the user's: Groq, LM Studio, Ollama, anything OpenAI-shaped.
// Not all of them accept `response_format`, so a provider that rejects it is
// remembered here and never asked again this session — the extraction prompt
// already demands JSON in words, which is what we relied on before.
const noJsonMode = new Set<string>();

// Only the statuses a provider uses to say "I don't take this field". A 401 (bad
// key) or 429 (rate) must fail straight away instead of costing a second call.
function rejectsJsonMode(status: number): boolean {
  return status === 400 || status === 404 || status === 422 || status === 501;
}

// --- pacing from the provider's own numbers ---------------------------------
// Groq, OpenAI, OpenRouter and Cerebras say in every answer how many tokens are
// left this minute and when the window resets (x-ratelimit-*), and in a 429 how
// long to wait (retry-after). Before this, Mori slept a fixed 20 s between the
// pieces of a long call and 60 s after any 429, tuned for the worst free tier:
// a 90-minute call spent minutes asleep with budget to spare.

type Budget = { limit: number | null; remaining: number | null; resetAt: number };
const budgets = new Map<string, Budget>();
const budgetKey = (cfg: ProviderConfig) => `${cfg.baseUrl.trim()}|${cfg.model}`;

/** "7.66s", "1m2.5s", "250ms", "2" (seconds) → milliseconds; null if unreadable. */
export function parseResetMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = parseFloat(m[1]);
    ms += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(ms) : null;
}

/** Remember what the provider said about its budget. */
export function noteRateHeaders(cfg: ProviderConfig, h: { get(name: string): string | null } | undefined, now = Date.now()): void {
  if (typeof h?.get !== "function") return; // a test double, or a very odd fetch
  const num = (x: string | null) => (x !== null && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);
  const limit = num(h.get("x-ratelimit-limit-tokens"));
  const remaining = num(h.get("x-ratelimit-remaining-tokens"));
  const reset = parseResetMs(h.get("x-ratelimit-reset-tokens"));
  if (limit === null && remaining === null) return;
  budgets.set(budgetKey(cfg), { limit, remaining, resetAt: now + (reset ?? 60_000) });
  // The limit outlives the session: the first long call after a restart can
  // already go in one pass.
  if (limit !== null) {
    try {
      localStorage.setItem(`mori.tpm.${budgetKey(cfg)}`, String(limit));
    } catch {
      /* no storage (checks.mjs): this session only */
    }
  }
}

/** How long to wait before spending `tokens`: 0 when there is room (or nothing is known). */
export function budgetWaitMs(b: Budget | undefined, tokens: number, now = Date.now()): number {
  if (!b || b.remaining === null || b.resetAt <= now) return 0;
  return b.remaining >= tokens ? 0 : b.resetAt - now + 250;
}

/** Tokens per minute the provider allows, when it told us. */
export function tokensPerMinute(cfg: ProviderConfig): number | null {
  const known = budgets.get(budgetKey(cfg))?.limit;
  if (known) return known;
  try {
    const n = Number(localStorage.getItem(`mori.tpm.${budgetKey(cfg)}`));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** How long the provider's own budget asks to wait before `tokens` (capped at a minute). */
export function waitMsFor(cfg: ProviderConfig, tokens: number): number {
  return Math.min(60_000, budgetWaitMs(budgets.get(budgetKey(cfg)), tokens));
}

/** Wait only as long as the provider's own budget requires (capped at a minute). */
export async function waitForBudget(cfg: ProviderConfig, tokens: number): Promise<void> {
  const ms = waitMsFor(cfg, tokens);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** A 429 that knows how long the provider asked to wait. */
export class RateLimited extends Error {
  constructor(message: string, readonly waitMs: number) {
    super(message);
  }
}

// Reasoning models (gpt-oss) think before answering, and the thinking is paid in
// time and in tokens of the per-minute budget. Pulling facts out of a transcript
// does not need much of it: "low" is several times faster for the same JSON.
const isReasoningModel = (model: string) => /gpt-oss|(^|\/)o[134](-mini)?$/i.test(model);
const noReasoningEffort = new Set<string>();

export async function chatComplete(
  messages: ChatMessage[],
  cfg: ProviderConfig,
  opts: ChatOptions = {},
): Promise<string> {
  const providerKey = `${cfg.baseUrl}|${cfg.model}`;
  const wantJson = !!opts.json && !noJsonMode.has(providerKey);

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: false,
  };
  if (wantJson) payload.response_format = { type: "json_object" };
  const wantEffort = !!opts.effort && isReasoningModel(cfg.model) && !noReasoningEffort.has(providerKey);
  if (wantEffort) payload.reasoning_effort = opts.effort;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A local server needs no key; sending "Bearer " (empty) trips some of them.
  if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;

  const timeoutMs = opts.timeoutMs ?? (isLocalProvider(cfg) ? LOCAL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl.trim().replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(t("LLM: nessuna risposta dopo {s} s", { s: Math.round(timeoutMs / 1000) }));
      if (isLocalProvider(cfg)) {
        throw new Error(t("LLM locale non raggiungibile su {url}. È acceso? ({error})", { url: cfg.baseUrl, error: String(e) }));
      }
      throw e;
    }

    noteRateHeaders(cfg, res.headers);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        const hdr = (n: string) => (typeof res.headers?.get === "function" ? res.headers.get(n) : null);
        const wait = parseResetMs(hdr("retry-after")) ?? parseResetMs(hdr("x-ratelimit-reset-tokens")) ?? 20_000;
        throw new RateLimited(`LLM 429: ${body.slice(0, 300)}`, Math.min(90_000, wait + 250));
      }
      if (wantEffort && rejectsJsonMode(res.status) && /reasoning/i.test(body)) {
        noReasoningEffort.add(providerKey);
        return chatComplete(messages, cfg, { ...opts, effort: undefined });
      }
      if (wantJson && rejectsJsonMode(res.status)) {
        // Remember only when the provider actually named the offending field, so a
        // one-off 400 does not disable JSON mode for the whole session.
        if (/response_format|json_object|json mode/i.test(body)) noJsonMode.add(providerKey);
        return chatComplete(messages, cfg, { ...opts, json: false });
      }
      throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? t("(nessuna risposta)");
  } finally {
    clearTimeout(timer);
  }
}

// --- streaming ---------------------------------------------------------------
// The answer appears as it is written instead of after a silent wait. OpenAI-
// shaped servers (Groq, OpenAI, OpenRouter, Ollama, LM Studio) all stream the
// same Server-Sent Events: lines "data: {json}" ending with "data: [DONE]".

/** Split what arrived so far into complete SSE events. Pure, for the checks:
 *  returns the text deltas, the unfinished tail to keep, and whether [DONE] came. */
export function parseSse(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const deltas: string[] = [];
  let done = false;
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? ""; // the last line may still be arriving
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue; // comments (": keep-alive"), event names, blanks
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
      const piece = j.choices?.[0]?.delta?.content;
      if (piece) deltas.push(piece);
    } catch {
      /* a malformed event is skipped, not fatal */
    }
  }
  return { deltas, rest, done };
}

/**
 * Like chatComplete, but `onText` receives the answer as it grows. Falls back
 * to a plain request when the provider will not stream (or the body cannot be
 * read), so callers never need to care.
 */
export async function chatStream(
  messages: ChatMessage[],
  cfg: ProviderConfig,
  onText: (soFar: string) => void,
  opts: { idleMs?: number } = {},
): Promise<string> {
  // A local model on CPU sends nothing while it reads a long prompt: give it
  // time before the first word; a cloud one that stays silent this long is stuck.
  const idleMs = opts.idleMs ?? (isLocalProvider(cfg) ? 300_000 : 90_000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;

  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), idleMs);
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), idleMs);
  };
  try {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl.trim().replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, stream: true }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(t("LLM: nessuna risposta dopo {s} s", { s: Math.round(idleMs / 1000) }));
      if (isLocalProvider(cfg)) {
        throw new Error(t("LLM locale non raggiungibile su {url}. È acceso? ({error})", { url: cfg.baseUrl, error: String(e) }));
      }
      throw e;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Some servers refuse `stream`: ask again the plain way.
      if (res.status === 400 && /stream/i.test(body)) {
        const text = await chatComplete(messages, cfg);
        onText(text);
        return text;
      }
      throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
    }

    // Decide BEFORE taking the reader: once a body is locked by getReader(),
    // res.json() can no longer read it ("Body is unusable").
    const type = res.headers?.get?.("content-type") ?? "";
    const reader = /application\/json/i.test(type) ? undefined : res.body?.getReader?.();
    if (!reader) {
      // Not a stream after all (or a body we cannot read incrementally).
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim() ?? t("(nessuna risposta)");
      onText(text);
      return text;
    }

    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        poke();
        buf += dec.decode(value, { stream: true });
        const r = parseSse(buf);
        buf = r.rest;
        if (r.deltas.length) {
          full += r.deltas.join("");
          onText(full);
        }
        if (r.done) break;
      }
    } catch (e) {
      // The connection dropped mid-answer: keep what was already written.
      if (!full.trim()) throw ctrl.signal.aborted ? new Error(t("LLM: nessuna risposta dopo {s} s", { s: Math.round(idleMs / 1000) })) : e;
      full += " …\n\n_(" + t("risposta interrotta") + ")_";
      onText(full);
      return full;
    }
    // A last event without a trailing newline.
    const tail = parseSse(buf + "\n");
    if (tail.deltas.length) {
      full += tail.deltas.join("");
      onText(full);
    }
    return full.trim() || t("(nessuna risposta)");
  } finally {
    clearTimeout(timer);
  }
}

/** "Verifica" in the settings: one tiny request, a human verdict. */
export async function testProvider(cfg: ProviderConfig): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = Date.now();
  if (!cfg.baseUrl.trim()) return { ok: false, message: t("Manca l'indirizzo del provider."), ms: 0 };
  if (!cfg.model.trim()) return { ok: false, message: t("Manca il nome del modello."), ms: 0 };
  if (!providerReady(cfg)) return { ok: false, message: t("Manca la chiave API (serve per i provider in cloud)."), ms: 0 };
  try {
    const answer = await chatComplete(
      [
        { role: "system", content: "Rispondi solo con la parola: pronto" },
        { role: "user", content: "Ci sei?" },
      ],
      cfg,
      { timeoutMs: 45_000 },
    );
    const ms = Date.now() - t0;
    return { ok: true, message: t("Risponde ({s} s): “{answer}”", { s: (ms / 1000).toFixed(1), answer: answer.slice(0, 40) }), ms };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const hint = /\b401\b|\b403\b/.test(msg)
      ? t("Chiave non valida o senza permessi.")
      : /\b404\b/.test(msg)
        ? t("Modello o indirizzo non trovato: controlla il nome del modello.")
        : /\b429\b/.test(msg)
          ? t("Il provider risponde ma ti sta limitando (troppe richieste). Riprova tra un minuto.")
          : msg.slice(0, 200);
    return { ok: false, message: hint, ms: Date.now() - t0 };
  }
}
