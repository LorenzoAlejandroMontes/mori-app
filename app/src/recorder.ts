import { invoke } from "@tauri-apps/api/core";
import { db, type Segment } from "./db";
import { canonicalNames } from "./vocab";
import { t } from "./i18n";

export type RecPaths = { wav: string; stop: string };

export const startRecording = () => invoke<RecPaths>("start_recording");

// Stop + wait until the WAV is saved; returns the WAV path (fast, no transcription).
export const stopRecording = (p: RecPaths) =>
  invoke<string>("stop_recording", { wav: p.wav, stop: p.stop });

// Transcribe a saved WAV with local Whisper (long — run in the background).
// `vocab` (optional) is a comma-separated list of the user's people/projects that
// biases Whisper's spelling. Returns a raw string — parse it with
// parseTranscribeResult (JSON wrapper) since older recordings may return plain text.
export const transcribeFile = (wav: string, model: string, vocab?: string, context?: string, cloud?: SttCloud | null) =>
  invoke<string>("transcribe_file", { wav, model, vocab: vocab ?? null, context: context?.trim() || null, cloud: cloud ?? null });

export type TranscribeResult = {
  text: string;
  segments: Segment[];
  language: string;
  audioPath: string | null;
  /** The cloud was asked and did not do it: why (the local Whisper did). */
  cloudError: string | null;
};

// Parse what transcribe_file returns. Rust wraps the Python JSON as
// `{"audio_path": "...", "result": {text, language, segments}}`. Tolerant of:
//  - the empty string (empty/silent recording) → null
//  - legacy plain text (no JSON) → treat the whole thing as `text`, no segments.
export function parseTranscribeResult(raw: string): TranscribeResult | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const outer = JSON.parse(s) as {
      audio_path?: string;
      cloud_error?: string;
      result?: { text?: string; language?: string; segments?: Segment[] };
    };
    const r = outer.result ?? {};
    const text = (r.text ?? "").trim();
    if (!text) return null;
    return {
      text,
      segments: Array.isArray(r.segments) ? r.segments : [],
      language: r.language ?? "",
      audioPath: outer.audio_path ?? null,
      cloudError: outer.cloud_error ?? null,
    };
  } catch {
    // Legacy / non-JSON output: whole string is the transcript.
    return { text: s, segments: [], language: "", audioPath: null, cloudError: null };
  }
}

// Whisper quality/model (speed vs accuracy). Persisted in the DB like the provider.
export type WhisperModel = "medium" | "large-v3-turbo";
const ALLOWED: WhisperModel[] = ["medium", "large-v3-turbo"];
const DEFAULT_MODEL: WhisperModel = "large-v3-turbo";
let _wm: WhisperModel | null = null;

export async function loadWhisperModel(): Promise<WhisperModel> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>(
      "SELECT value FROM app_setting WHERE key = 'whisper_model'",
    );
    const v = rows[0]?.value as WhisperModel;
    // Coerce any legacy/removed choice (base/small/large-v3) to the default.
    _wm = ALLOWED.includes(v) ? v : DEFAULT_MODEL;
  } catch {
    _wm = DEFAULT_MODEL;
  }
  return _wm;
}

export function getWhisperModel(): WhisperModel {
  return _wm ?? DEFAULT_MODEL;
}

export async function saveWhisperModel(m: WhisperModel): Promise<void> {
  _wm = m;
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ('whisper_model', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
    [m],
  );
}

// A sentence about what the user usually talks about ("Lavoro in una ONG, si
// parla di bandi, volontari e donazioni"). Whisper reads it before every call,
// so the jargon of THEIR world comes out spelled right. Empty = neutral.
let _ctx: string | null = null;

export async function loadWhisperContext(): Promise<string> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>("SELECT value FROM app_setting WHERE key = 'whisper_context'");
    _ctx = rows[0]?.value ?? "";
  } catch {
    _ctx = "";
  }
  return _ctx;
}

export function getWhisperContext(): string {
  return _ctx ?? "";
}

export async function saveWhisperContext(text: string): Promise<void> {
  _ctx = text.trim();
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ('whisper_context', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
    [_ctx],
  );
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>("SELECT value FROM app_setting WHERE key = $1", [key]);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

// --- Where the words are recognized ------------------------------------------
// "local": Whisper on this PC — private, free, and slow on a laptop CPU (an hour
// of call is tens of minutes). "cloud": Groq's free whisper-large-v3-turbo —
// seconds for the same hour; only the SPEECH leaves the PC (silence is cut
// here), Groq does not train on it. The DEFAULT since 5 Oct 2026
// (speed matters more); "local" stays one click away and is respected
// once chosen. Never for a private call: the queue asks per call (jobs.ts).
// No Groq key, or the cloud fails → the local Whisper, on its own.

export type SttMode = "local" | "cloud";
export type SttCloud = { url: string; key: string; model: string };
export const GROQ_URL = "https://api.groq.com/openai/v1";
const STT_MODEL = "whisper-large-v3-turbo";
let _stt: { mode: SttMode; key: string } = { mode: "cloud", key: "" };

export async function loadSttSettings(): Promise<{ mode: SttMode; key: string }> {
  // Not chosen yet → cloud; only an explicit "local" keeps Whisper on the PC.
  const mode = (await readSetting("stt_mode")) === "local" ? "local" : "cloud";
  _stt = { mode, key: (await readSetting("stt_key")) ?? "" };
  return _stt;
}

export function getSttSettings(): { mode: SttMode; key: string } {
  return _stt;
}

export async function saveSttSettings(mode: SttMode, key: string): Promise<void> {
  _stt = { mode, key: key.trim() };
  await writeSetting("stt_mode", mode);
  await writeSetting("stt_key", _stt.key);
}

/** The key for Groq: its own field, or the model's key when the model is Groq. */
export function sttKeyFor(own: string, provider: { baseUrl: string; apiKey: string }): string {
  if (own.trim()) return own.trim();
  try {
    if (new URL(provider.baseUrl.trim()).hostname === "api.groq.com") return provider.apiKey.trim();
  } catch {
    /* not a URL */
  }
  return "";
}

/** Why Groq did not transcribe, in words the user can act on. Pure. */
export function cloudFallbackMessage(err: string): string {
  if (/\b40[13]\b|invalid api key|unauthori/i.test(err))
    return t("La chiave Groq non è valida: ho trascritto sul PC, più lentamente. Controllala in Impostazioni → Trascrizione.");
  if (/\b429\b|limite gratuito|rate limit/i.test(err))
    return t("Hai finito l'audio gratuito di Groq per ora: ho trascritto sul PC, più lentamente. Si ricarica da solo.");
  if (/rete|timed out|timeout|urlopen|connection|name resolution/i.test(err))
    return t("Groq non era raggiungibile: ho trascritto sul PC, più lentamente.");
  return t("Groq non ha trascritto questa call: l'ho fatto sul PC, più lentamente.");
}

/** The cloud Whisper for one call, or null: local mode, no key, or a PRIVATE call. */
export function sttCloudFor(sensitive: boolean, provider: { baseUrl: string; apiKey: string }): SttCloud | null {
  if (sensitive || _stt.mode !== "cloud") return null;
  const key = sttKeyFor(_stt.key, provider);
  return key ? { url: GROQ_URL, key, model: STT_MODEL } : null;
}

// --- What happens to the audio after the transcript --------------------------
// It used to be kept forever in ~/.mori/audio, to replay a line: ~30–60 MB an
// hour even as FLAC, and nobody listens to most of it. Now:
//   "none"   (default) — deleted as soon as the transcript is safely saved;
//   "local"  — kept on this PC, compressed, as before;
//   "folder" — compressed and moved to a folder the user picks (OneDrive,
//              Google Drive, an external disk): with "files on demand" it
//              stops taking space on the PC, and it is still a click away.
// Audio is never deleted while the transcription has not succeeded.

export type AudioKeep = "none" | "local" | "folder";
let _keep: { keep: AudioKeep; dir: string } = { keep: "none", dir: "" };

export async function loadAudioKeep(): Promise<{ keep: AudioKeep; dir: string }> {
  const v = await readSetting("audio_keep");
  const keep: AudioKeep = v === "local" || v === "folder" ? v : "none";
  _keep = { keep, dir: (await readSetting("audio_dir")) ?? "" };
  if (_keep.keep === "folder" && _keep.dir) await invoke("allow_audio_dir", { dir: _keep.dir }).catch(() => {});
  return _keep;
}

export function getAudioKeep(): { keep: AudioKeep; dir: string } {
  return _keep;
}

export async function saveAudioKeep(keep: AudioKeep, dir: string): Promise<void> {
  _keep = { keep, dir: dir.trim() };
  await writeSetting("audio_keep", keep);
  await writeSetting("audio_dir", _keep.dir);
  if (keep === "folder" && _keep.dir) await invoke("allow_audio_dir", { dir: _keep.dir }).catch(() => {});
}

// Whether to suggest recording when a call app is in the foreground (default on).
// Persisted in app_setting like the other preferences; cached for sync reads.
let _callDetect: boolean | null = null;

export async function loadCallDetect(): Promise<boolean> {
  try {
    const d = await db();
    const rows = await d.select<{ value: string }[]>(
      "SELECT value FROM app_setting WHERE key = 'call_detect'",
    );
    _callDetect = rows[0] ? rows[0].value !== "0" : true;
  } catch {
    _callDetect = true;
  }
  return _callDetect;
}

export function getCallDetect(): boolean {
  return _callDetect ?? true;
}

export async function saveCallDetect(on: boolean): Promise<void> {
  _callDetect = on;
  const d = await db();
  await d.execute(
    "INSERT INTO app_setting (key, value) VALUES ('call_detect', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
    [on ? "1" : "0"],
  );
}

// Build the vocabulary hint passed to Whisper: the user's recurring people and
// projects, so the model spells their names right. Sources = the name dictionary
// the user curates (vocab_term — these come FIRST, they are the deliberate ones)
// + recent participants (last 90 days) + known entities (person/project/org),
// most frequent first, deduped case-insensitively, capped at 40 names / 400
// chars. Returns a comma-separated string ("" when there's nothing yet).
export async function buildVocab(): Promise<string> {
  try {
    const d = await db();
    const curated = await canonicalNames().catch(() => [] as string[]);
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const parts = await d.select<{ name: string; c: number }[]>(
      `SELECT p.display_name AS name, COUNT(*) AS c
         FROM session_participant p JOIN session s ON s.id = p.session_id
        WHERE COALESCE(s.started_at, s.created_at) >= $1
        GROUP BY lower(p.display_name)`,
      [cutoff],
    );
    const ents = await d.select<{ name: string; c: number }[]>(
      `SELECT e.name AS name, COUNT(se.session_id) AS c
         FROM entity e LEFT JOIN session_entity se ON se.entity_id = e.id
        WHERE e.kind IN ('person', 'project', 'org')
        GROUP BY e.id`,
    );

    // Merge weights by lowercased name, keeping the first-seen casing.
    const weight = new Map<string, { name: string; c: number }>();
    for (const r of [...parts, ...ents]) {
      const nm = r.name?.trim();
      if (!nm || nm.length < 2) continue;
      const key = nm.toLowerCase();
      const cur = weight.get(key);
      if (cur) cur.c += r.c;
      else weight.set(key, { name: nm, c: r.c });
    }

    // Curated names first (in their own order), then the observed ones by weight.
    const ordered = [...weight.values()].sort((a, b) => b.c - a.c);
    const picked: string[] = [];
    const seen = new Set<string>();
    for (const n of [...curated, ...ordered.map((o) => o.name)]) {
      const k = n.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      picked.push(n.trim());
    }

    const out: string[] = [];
    let chars = 0;
    for (const name of picked) {
      if (out.length >= 40) break;
      const add = (out.length ? 2 : 0) + name.length; // ", " separator
      if (chars + add > 400) break;
      out.push(name);
      chars += add;
    }
    return out.join(", ");
  } catch {
    return "";
  }
}
