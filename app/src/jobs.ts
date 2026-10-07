import { invoke } from "@tauri-apps/api/core";
import { db, deleteSession, audioFilesOf } from "./db";
import { organizeSession } from "./organize";
import { indexSession } from "./index";
import { finishRecording, failRecording } from "./ingest";
import {
  transcribeFile,
  parseTranscribeResult,
  getWhisperModel,
  buildVocab,
  getWhisperContext,
  sttCloudFor,
  getAudioKeep,
} from "./recorder";
import { providerFor, getConfig } from "./llm";
import { lang, t } from "./i18n";
import { compressSessionAudio } from "./backup";

// The durable work queue. Before this, transcribe → finishRecording → organize
// was a promise chain in App.tsx: closing the app or a failing LLM lost the work
// and nobody retried (two real calls of 14 Sept stayed raw for four days). Now
// every step is a row in `job`: it survives a restart, carries its own attempt
// count, and keeps its last error so the call can show a "Riprova" button.
//
// ONE runner processes jobs SEQUENTIALLY. That is also what keeps the free-tier
// pacing honest (~8000 tokens/min on Groq): two organizes can never overlap, so
// the sleeps in organize.ts (`llmRetry`, `condense`) still mean what they say.

export type JobKind = "transcribe" | "organize" | "index" | "compress";
export type JobStatus = "pending" | "running" | "done" | "failed";

export type Job = {
  id: string;
  session_id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  payload_json: string;
  next_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscribePayload = { wav?: string; model?: string; vocab?: string };

/** A parked job's reason is kept in last_error with status 'pending': that is a
 *  wait, not a failure — the UI shows it as such. */
/** The two waiting notices are stored in Italian (isWaitingNotice matches
 *  them): shown in the user's language. */
export function noticeText(stored: string | null): string {
  if (!stored) return "";
  if (stored.startsWith("Call privata: la capisco solo con un modello locale"))
    return t("Call privata: la capisco solo con un modello locale. Impostalo in Impostazioni → Modello.");
  if (stored.startsWith("In attesa: configura il provider")) return t("In attesa: configura il provider nelle impostazioni.");
  return stored;
}

export function isWaitingNotice(j: { status: JobStatus; lastError: string | null }): boolean {
  return j.status === "pending" && !!j.lastError && /^(In attesa|Call privata)/.test(j.lastError);
}

const MAX_ATTEMPTS = 3;
// Backoff before retry n (1-based). Generous: most failures here are the free
// tier's tokens-per-minute wall, which clears in a minute.
const BACKOFF_MS = [20_000, 90_000, 300_000];
const TICK_MS = 30_000; // wakes the runner so a scheduled retry actually fires
const HEARTBEAT_MS = 20_000; // a running job says "I'm alive" on its own row
const STALE_MS = 3 * 60_000; // no heartbeat for this long = the app died mid-job

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

// Thrown when a job cannot run through no fault of its own (no provider key
// configured yet). The job goes back to pending WITHOUT burning an attempt and
// the runner stops until something calls pumpJobs() again.
//   scope "kind": nothing of this kind can run (no provider at all) → skip the kind.
//   scope "job":  only THIS job is blocked (a private call, no local model) →
//                 skip just it, so the ordinary calls behind it still go through.
class JobPaused extends Error {
  constructor(message: string, readonly scope: "kind" | "job" = "kind") {
    super(message);
  }
}

// --- listeners ---------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeJobs(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      /* a broken listener must not break the queue */
    }
  }
}

// --- "it is ready" ------------------------------------------------------------
// A call has been understood (summary, to-dos): the app says so, with a way to
// open it, wherever the user is — a toast in Mori, the pill when Mori is behind.

const readyListeners = new Set<(sessionId: string) => void>();

export function subscribeReady(cb: (sessionId: string) => void): () => void {
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

// The cloud Whisper was asked and the local one did the work instead: the app
// says why once (a bad key, the free hour used up), or Mori just looks slow.
const fallbackListeners = new Set<(why: string) => void>();

export function subscribeCloudFallback(cb: (why: string) => void): () => void {
  fallbackListeners.add(cb);
  return () => {
    fallbackListeners.delete(cb);
  };
}

function emitReady(sessionId: string) {
  for (const cb of [...readyListeners]) {
    try {
      cb(sessionId);
    } catch {
      /* a broken listener must not break the queue */
    }
  }
}

// --- what Whisper is on right now ----------------------------------------------
// The live line (src/progress.ts) needs the file being transcribed, which only
// this runner knows: the WAV of the payload, or the kept audio on a retry.

export type Transcribing = { sessionId: string; wav: string };
let _transcribing: Transcribing | null = null;

export function transcribingNow(): Transcribing | null {
  return _transcribing;
}

function setTranscribing(t: Transcribing | null) {
  if (_transcribing?.wav === t?.wav && _transcribing?.sessionId === t?.sessionId) return;
  _transcribing = t;
  notify();
}

// --- queue writes ------------------------------------------------------------

/** Queue a step for a session. Idempotent: an already queued/running job of the
 *  same kind wins, a finished or failed one is revived (same row, attempts reset). */
export async function enqueueJob(
  kind: JobKind,
  sessionId: string,
  payload: Record<string, unknown> = {},
  tellUi = true,
): Promise<void> {
  const d = await db();
  const t = now();
  const [row] = await d.select<{ id: string; status: JobStatus }[]>(
    `SELECT id, status FROM job WHERE session_id = $1 AND kind = $2
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId, kind],
  );
  if (row && (row.status === "pending" || row.status === "running")) return;
  if (row) {
    await d.execute(
      `UPDATE job SET status = 'pending', attempts = 0, last_error = NULL,
              payload_json = $1, next_at = $2, updated_at = $2
        WHERE id = $3`,
      [JSON.stringify(payload), t, row.id],
    );
  } else {
    // OR IGNORE: the partial unique index (session_id, kind) over live rows makes
    // a concurrent double-enqueue a no-op instead of a second job.
    await d.execute(
      `INSERT OR IGNORE INTO job (id, session_id, kind, status, attempts, last_error, payload_json, next_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', 0, NULL, $4, $5, $5, $5)`,
      [uid(), sessionId, kind, JSON.stringify(payload), t],
    );
  }
  // Bulk callers (startup recovery) pass false and notify once at the end, so a
  // fresh install does not fire one full UI refresh per queued call.
  if (tellUi) notify();
}

async function updatePayload(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const d = await db();
  await d.execute(`UPDATE job SET payload_json = $1, updated_at = $2 WHERE id = $3`, [
    JSON.stringify(payload),
    now(),
    jobId,
  ]);
}

/** Atomically take the next due job, skipping kinds that are parked this round.
 *  The conditional UPDATE is the claim: if a second runner (another window) got
 *  there first, rowsAffected is 0. */
async function claimNext(skip: Set<JobKind>, skipIds: Set<string> = new Set()): Promise<Job | "retry" | null> {
  const d = await db();
  const t = now();
  const due = await d.select<Job[]>(
    `SELECT * FROM job
      WHERE status = 'pending' AND (next_at IS NULL OR next_at <= $1)
      ORDER BY created_at LIMIT 200`,
    [t],
  );
  // A parked kind (no provider key yet) must not hide the work behind it: the
  // oldest job is skipped, not allowed to stop the queue.
  const cand = due.find((j) => !skip.has(j.kind) && !skipIds.has(j.id));
  if (!cand) return null;
  const res = await d.execute(
    `UPDATE job SET status = 'running', attempts = attempts + 1, updated_at = $1
      WHERE id = $2 AND status = 'pending'`,
    [t, cand.id],
  );
  if (!res.rowsAffected) return "retry";
  return { ...cand, status: "running", attempts: cand.attempts + 1 };
}

async function finishJob(id: string, status: "done" | "failed", error: string | null): Promise<void> {
  const d = await db();
  await d.execute(
    `UPDATE job SET status = $1, last_error = $2, next_at = NULL, updated_at = $3 WHERE id = $4`,
    [status, error, now(), id],
  );
}

async function scheduleRetry(id: string, error: string, attempts: number): Promise<void> {
  const d = await db();
  const wait = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? 60_000;
  await d.execute(
    `UPDATE job SET status = 'pending', last_error = $1, next_at = $2, updated_at = $3 WHERE id = $4`,
    [error, iso(wait), now(), id],
  );
}

/** Put a paused job back without spending the attempt. */
async function releaseJob(id: string, reason: string): Promise<void> {
  const d = await db();
  await d.execute(
    `UPDATE job SET status = 'pending', attempts = MAX(attempts - 1, 0), last_error = $1,
            next_at = $2, updated_at = $2 WHERE id = $3`,
    [reason, now(), id],
  );
}

// --- the runner --------------------------------------------------------------

let pumping = false;
let pumpAgain = false;
let ticker: ReturnType<typeof setInterval> | null = null;

/** Process every due job, one at a time, until the queue is empty or blocked. */
export async function pumpJobs(): Promise<void> {
  if (pumping) {
    pumpAgain = true;
    return;
  }
  pumping = true;
  const parked = new Set<JobKind>();
  const parkedIds = new Set<string>();
  try {
    // Bounded so a permanently-contended claim can never spin forever.
    for (let guard = 0; guard < 500; guard++) {
      const job = await claimNext(parked, parkedIds);
      if (job === null) break;
      if (job === "retry") continue;
      const paused = await runJob(job);
      notify();
      if (paused === "kind") parked.add(job.kind);
      else if (paused === "job") parkedIds.add(job.id);
    }
  } finally {
    pumping = false;
  }
  if (pumpAgain) {
    pumpAgain = false;
    void pumpJobs();
  }
}

/** What to skip for the rest of this round: the whole kind, this job, or nothing. */
async function runJob(job: Job): Promise<"kind" | "job" | false> {
  // While it runs, the row says so: another window must not mistake a long
  // transcription for a job orphaned by a crash and start it a second time.
  const beat = setInterval(() => void touchJob(job.id), HEARTBEAT_MS);
  try {
    await handle(job);
    await finishJob(job.id, "done", null);
    if (job.kind === "organize") emitReady(job.session_id);
    return false;
  } catch (e) {
    if (e instanceof JobPaused) {
      await releaseJob(job.id, e.message);
      return e.scope;
    }
    const msg = String(e instanceof Error ? e.message : e).slice(0, 1000);
    if (job.attempts >= MAX_ATTEMPTS) {
      await finishJob(job.id, "failed", msg);
      // A transcription that gave up must stop pretending to be in progress.
      if (job.kind === "transcribe") await failRecording(job.session_id).catch(() => {});
    } else {
      await scheduleRetry(job.id, msg, job.attempts);
    }
    return false;
  } finally {
    clearInterval(beat);
  }
}

async function touchJob(id: string): Promise<void> {
  try {
    const d = await db();
    await d.execute(`UPDATE job SET updated_at = $1 WHERE id = $2 AND status = 'running'`, [now(), id]);
  } catch {
    /* the heartbeat is best-effort */
  }
}

async function handle(job: Job): Promise<void> {
  if (job.kind === "transcribe") return runTranscribe(job);
  if (job.kind === "organize") return runOrganize(job);
  if (job.kind === "index") return runIndex(job);
  if (job.kind === "compress") return runCompress(job);
  throw new Error(t("tipo di lavoro sconosciuto: {kind}", { kind: job.kind }));
}

async function runTranscribe(job: Job): Promise<void> {
  const d = await db();
  // Idempotent: if a previous attempt already saved the transcript, we're done.
  const [tr] = await d.select<{ n: number }[]>(
    `SELECT COALESCE(length(memo), 0) n FROM session_transcript WHERE session_id = $1 LIMIT 1`,
    [job.session_id],
  );
  if ((tr?.n ?? 0) > 0) {
    await enqueueJob("organize", job.session_id, {});
    return;
  }

  const p = JSON.parse(job.payload_json || "{}") as TranscribePayload;
  // The WAV lives in the payload so the job can re-run after a crash. A previous
  // successful transcription MOVES it to ~/.mori/audio, so the kept path is the
  // second candidate. We never delete audio on failure — neither here nor in Rust.
  const [srow] = await d.select<{ audio_path: string | null; sensitive: number | null }[]>(
    `SELECT audio_path, sensitive FROM session WHERE id = $1`,
    [job.session_id],
  );
  // The fast cloud Whisper only when the user chose it, and never for a call
  // already marked private: its audio does not leave the PC.
  const cloud = sttCloudFor((srow?.sensitive ?? 0) === 1, getConfig());
  const candidates = [p.wav, srow?.audio_path].filter((x): x is string => !!x);
  const tried = new Set<string>();
  const model = p.model || getWhisperModel();
  const vocab = p.vocab ?? (await buildVocab());

  // Whisper's neutral hint is Italian ("Conversazione di lavoro."), which leans
  // it toward Italian: someone using Mori in English gets an English one.
  const context = getWhisperContext() || (lang() === "en" ? "Work conversation." : "");

  let raw: string | null = null;
  let lastErr: unknown = new Error(t("nessun file audio da trascrivere per questa call"));
  try {
    for (const wav of candidates) {
      if (tried.has(wav)) continue;
      tried.add(wav);
      try {
        setTranscribing({ sessionId: job.session_id, wav });
        raw = await transcribeFile(wav, model, vocab, context, cloud);
        break;
      } catch (e) {
        lastErr = e;
        // Only a missing file is worth trying the next candidate for.
        if (!/not found|non trovato/i.test(String(e))) throw e;
      }
    }
  } finally {
    setTranscribing(null);
  }
  if (raw === null) throw lastErr;

  const parsed = parseTranscribeResult(raw);
  if (parsed?.cloudError) {
    for (const cb of [...fallbackListeners]) {
      try {
        cb(parsed.cloudError);
      } catch {
        /* a broken listener must not break the queue */
      }
    }
  }
  if (!parsed) {
    // Empty / silent recording: drop the placeholder so no junk call is left.
    // This also cascades this very job row away — finishJob then updates nothing.
    await deleteSession(job.session_id);
    return;
  }

  // The call was deleted while Whisper was busy: the audio it just kept belongs
  // to nobody now. Remove it instead of leaving an orphan recording on disk.
  const [still] = await d.select<{ n: number }[]>(`SELECT COUNT(*) n FROM session WHERE id = $1`, [job.session_id]);
  if (!still?.n) {
    for (const f of audioFilesOf(parsed.audioPath)) await invoke("delete_file", { path: f }).catch(() => {});
    return;
  }

  // Remember where the audio ended up BEFORE writing the transcript: if the write
  // fails, the retry still knows which file to read.
  if (parsed.audioPath && parsed.audioPath !== p.wav) {
    await updatePayload(job.id, { ...p, wav: parsed.audioPath });
  }

  await finishRecording(job.session_id, parsed.text, parsed.segments, parsed.language, parsed.audioPath);
  await enqueueJob("organize", job.session_id, {});
  if (!parsed.audioPath) return;
  // The transcript is saved: now — and only now — the audio may go.
  if (getAudioKeep().keep === "none") await dropSessionAudio(job.session_id);
  else await enqueueJob("compress", job.session_id, {});
}

/** Delete a call's kept audio and forget it: the transcript stays, the lines
 *  just cannot be replayed. Only Mori's own files (Rust refuses the rest). */
export async function dropSessionAudio(sessionId: string): Promise<boolean> {
  const d = await db();
  const [row] = await d.select<{ audio_path: string | null }[]>(`SELECT audio_path FROM session WHERE id = $1`, [sessionId]);
  const files = audioFilesOf(row?.audio_path);
  if (!files.length) return false;
  try {
    for (const f of files) await invoke("delete_file", { path: f });
  } catch {
    return false; // outside ~/.mori (a folder the user chose): theirs to manage
  }
  await d.execute(`UPDATE session SET audio_path = NULL, updated_at = $1 WHERE id = $2`, [now(), sessionId]);
  return true;
}

async function runOrganize(job: Job): Promise<void> {
  const d = await db();
  const [row] = await d.select<{ sensitive: number | null }[]>(`SELECT sensitive FROM session WHERE id = $1`, [
    job.session_id,
  ]);
  const sensitive = (row?.sensitive ?? 0) === 1;
  const cfg = providerFor(sensitive);
  if (!cfg) {
    if (sensitive && providerFor(false)) {
      // Only this call is blocked: the cloud model may read the others.
      throw new JobPaused(
        "Call privata: la capisco solo con un modello locale. Impostalo in Impostazioni → Modello.",
        "job",
      );
    }
    throw new JobPaused("In attesa: configura il provider nelle impostazioni.");
  }
  await organizeSession(job.session_id, cfg);
}

async function runIndex(job: Job): Promise<void> {
  await indexSession(job.session_id);
}

// Kept audio becomes FLAC once the transcript is safely in. Lossless, and the
// WAV is removed only after the FLAC has been decoded back and verified.
async function runCompress(job: Job): Promise<void> {
  const keep = getAudioKeep();
  // The setting may have changed since the job was queued.
  if (keep.keep === "none") {
    await dropSessionAudio(job.session_id);
    return;
  }
  const flac = await compressSessionAudio(job.session_id);
  if (keep.keep === "folder" && keep.dir) await moveSessionAudio(job.session_id, keep.dir, flac);
}

/** Move a call's kept audio into the user's folder (copy, verify, then remove). */
async function moveSessionAudio(sessionId: string, dir: string, known: string | null): Promise<void> {
  const d = await db();
  const [row] = await d.select<{ audio_path: string | null }[]>(`SELECT audio_path FROM session WHERE id = $1`, [sessionId]);
  const src = known ?? row?.audio_path;
  if (!src) return;
  const norm = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (norm(src).startsWith(norm(dir) + "/")) return; // already there
  const moved = await invoke<string>("move_audio", { src, dir });
  await d.execute(`UPDATE session SET audio_path = $1, updated_at = $2 WHERE id = $3`, [moved, now(), sessionId]);
}

// --- startup recovery --------------------------------------------------------

/** Called once at boot. Re-queues what was interrupted, and — this is how the two
 *  raw calls of 14 Sept get understood — queues an organize for every real call
 *  that has a transcript but no summary. Nothing is written by hand: the recovery
 *  goes through the same code path as a fresh recording. */
export async function resumeJobs(): Promise<void> {
  const d = await db();
  const t = now();

  // 1) A 'running' row whose heartbeat stopped means the app died mid-job. One
  //    that is still beating belongs to another window that is working on it
  //    right now — taking it back would run the same job twice. Its attempt was
  //    already counted, so a crash loop still ends in 'failed' instead of forever.
  await d.execute(
    `UPDATE job SET status = 'pending', next_at = $1, updated_at = $1
      WHERE status = 'running' AND updated_at < $2`,
    [t, new Date(Date.now() - STALE_MS).toISOString()],
  );

  // 2) Calls whose transcription never finished and has no job to resume: show
  //    them as failed so the call offers "Riprova" instead of spinning forever.
  await d.execute(
    `UPDATE session SET status = 'failed', updated_at = $1
      WHERE status = 'transcribing'
        AND NOT EXISTS (SELECT 1 FROM session_transcript t WHERE t.session_id = session.id)
        AND NOT EXISTS (SELECT 1 FROM job j WHERE j.session_id = session.id
                          AND j.kind = 'transcribe' AND j.status IN ('pending', 'running'))`,
    [t],
  );

  // 3) Real calls with a transcript and no summary → organize. `provider <> 'seed'`
  //    keeps the demo rows shipped by the migrations out of it.
  const raw = await d.select<{ id: string }[]>(
    `SELECT s.id FROM session s
       JOIN session_transcript t ON t.session_id = s.id
      WHERE length(COALESCE(t.memo, '')) > 0
        AND COALESCE(t.provider, '') <> 'seed'
        AND NOT EXISTS (SELECT 1 FROM session_document dd
                         WHERE dd.session_id = s.id AND dd.kind = 'summary')
      ORDER BY COALESCE(s.started_at, s.created_at)`,
  );
  for (const r of raw) await enqueueJob("organize", r.id, {}, false);

  // 4) Transcripts that were never chunked → recall would not see them at all.
  //    Same 'seed' filter: the demo calls must never enter the recall corpus, or
  //    Mori would answer with invented facts wearing a real title and date.
  const unindexed = await d.select<{ id: string }[]>(
    `SELECT s.id FROM session s
       JOIN session_transcript t ON t.session_id = s.id
      WHERE length(COALESCE(t.memo, '')) > 0
        AND COALESCE(t.provider, '') <> 'seed'
        AND NOT EXISTS (SELECT 1 FROM transcript_chunk c WHERE c.session_id = s.id)`,
  );
  for (const r of unindexed) await enqueueJob("index", r.id, {}, false);

  notify(); // once, not once per queued job
  if (!ticker) ticker = setInterval(() => void pumpJobs(), TICK_MS);
  await pumpJobs();
}

// --- what the UI reads -------------------------------------------------------

export type SessionJob = {
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
};

const RANK: Record<JobStatus, number> = { failed: 3, running: 2, pending: 1, done: 0 };

/** The one job worth showing per session: a failure beats work in progress. */
export async function jobsBySession(): Promise<Record<string, SessionJob>> {
  const d = await db();
  // 'compress' is pure housekeeping: if it fails the audio is simply still a
  // WAV, which is not something to put in front of the user as a broken call.
  const rows = await d.select<
    { session_id: string; kind: JobKind; status: JobStatus; attempts: number; last_error: string | null }[]
  >(`SELECT session_id, kind, status, attempts, last_error FROM job WHERE status <> 'done' AND kind <> 'compress'`);
  const out: Record<string, SessionJob> = {};
  for (const r of rows) {
    if (!r.session_id) continue;
    const cur = out[r.session_id];
    if (cur && RANK[cur.status] >= RANK[r.status]) continue;
    out[r.session_id] = {
      kind: r.kind,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
    };
  }
  return out;
}

/** "Riprova" on a call: clear the failures and run the queue again. */
export async function retrySession(sessionId: string): Promise<void> {
  const d = await db();
  const t = now();
  await d.execute(
    `UPDATE job SET status = 'pending', attempts = 0, last_error = NULL, next_at = $1, updated_at = $1
      WHERE session_id = $2 AND status = 'failed'`,
    [t, sessionId],
  );
  // A failed transcription leaves the call marked failed; put it back to work.
  await d.execute(
    `UPDATE session SET status = 'transcribing', updated_at = $1
      WHERE id = $2 AND status = 'failed'
        AND EXISTS (SELECT 1 FROM job j WHERE j.session_id = $2 AND j.kind = 'transcribe' AND j.status = 'pending')`,
    [t, sessionId],
  );
  notify();
  await pumpJobs();
}

/** Human, short, Italian — what the call's notice says. */
export function jobLabel(j: SessionJob): string {
  const what =
    j.kind === "transcribe"
      ? t("La trascrizione")
      : j.kind === "organize"
        ? t("La sintesi")
        : j.kind === "compress"
          ? t("La compressione dell'audio")
          : t("L'indicizzazione");
  if (j.status === "failed") return t("{what} non è riuscita dopo {n} tentativi.", { what, n: j.attempts });
  if (j.status === "running") return t("{what} è in corso…", { what });
  return t("{what} è in coda.", { what });
}

/** "Libera spazio": delete the kept audio of every call already transcribed.
 *  A call still waiting for (or in) its transcription keeps it — that audio is
 *  the only copy of what was said. Returns how many calls lost their audio. */
export async function dropAllKeptAudio(): Promise<number> {
  const d = await db();
  const rows = await d.select<{ id: string }[]>(
    `SELECT s.id FROM session s
      WHERE s.audio_path IS NOT NULL AND s.audio_path <> ''
        AND EXISTS (SELECT 1 FROM session_transcript t WHERE t.session_id = s.id AND COALESCE(length(t.memo), 0) > 0)
        AND NOT EXISTS (SELECT 1 FROM job j WHERE j.session_id = s.id AND j.kind = 'transcribe' AND j.status IN ('pending', 'running'))`,
  );
  let n = 0;
  for (const r of rows) if (await dropSessionAudio(r.id)) n++;
  return n;
}
