// How far a transcription is and how long it still needs. Pure: no React, no
// Tauri, so scripts/checks.mjs runs it as is. The raw numbers come from the
// file Whisper rewrites twice a second (scripts/progress_file.py).
import { t } from "./i18n";

export type RawProgress = {
  /** "load": the model is coming up, the length is not known yet. */
  stage: "load" | "run";
  /** Seconds of audio already transcribed, and in all. */
  done: number;
  total: number;
  /** Epoch seconds when Whisper started on the audio (0 while loading). */
  started: number;
};

export type Progress = {
  stage: "load" | "run";
  /** 0…1, or null when there is nothing to measure yet. */
  fraction: number | null;
  /** Seconds left, or null until the speed is known. */
  etaSecs: number | null;
};

export function parseProgress(text: string | null | undefined): RawProgress | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (j.stage !== "load" && j.stage !== "run") return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    return { stage: j.stage, done: num(j.done), total: num(j.total), started: num(j.started) };
  } catch {
    // A half-written file cannot happen (it is renamed into place), an old or
    // foreign one can: no line is better than a wrong one.
    return null;
  }
}

/** Below these the speed is noise: the first segments come in bursts. */
const MIN_ELAPSED_S = 8;
const MIN_FRACTION = 0.03;

export function estimate(raw: RawProgress | null, nowMs: number): Progress {
  if (!raw || raw.stage === "load" || raw.total <= 0) return { stage: raw?.stage ?? "load", fraction: null, etaSecs: null };
  // Never 100 % while Whisper is still at it: the end comes when the call opens.
  const fraction = Math.min(0.99, Math.max(0, raw.done / raw.total));
  const elapsed = raw.started > 0 ? nowMs / 1000 - raw.started : 0;
  if (elapsed < MIN_ELAPSED_S || fraction < MIN_FRACTION) return { stage: "run", fraction, etaSecs: null };
  // Speed so far, in audio seconds per second. VAD skips the silences, so the
  // line jumps over them: the average over the whole run smooths it out.
  const speed = raw.done / elapsed;
  const etaSecs = speed > 0 ? Math.max(0, (raw.total - raw.done) / speed) : null;
  return { stage: "run", fraction, etaSecs };
}

/** "meno di un minuto", "circa 4 min", "circa 1 h 20 min". */
export function fmtEta(secs: number): string {
  if (secs < 60) return t("meno di un minuto");
  const min = Math.ceil(secs / 60);
  if (min < 60) return t("circa {n} min", { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("circa {h} h {m} min", { h, m }) : t("circa {h} h", { h });
}

/** The line under the title: "42 % · circa 4 min", or what is going on. */
export function progressLine(p: Progress | null): string {
  if (!p || p.stage === "load") return t("Preparo Whisper…");
  if (p.fraction === null) return t("Inizio…");
  const pct = `${Math.round(p.fraction * 100)}%`;
  return p.etaSecs === null ? t("{pct} · stimo il tempo…", { pct }) : `${pct} · ${fmtEta(p.etaSecs)}`;
}

/** Where "understanding" is: the pieces of a long call, then the whole. */
export type UnderstandState = { step: number; steps: number; waitUntil: number | null };

/** 0…1 for the line: a request counts half while it is being made. */
export function understandFraction(u: UnderstandState): number {
  const steps = Math.max(1, u.steps);
  return Math.min(0.95, Math.max(0.05, (u.step + 0.5) / steps));
}

/** "parte 2 di 4", "scrivo la sintesi", or the pause the provider asked for. */
export function understandLine(u: UnderstandState | null, nowMs: number): string {
  if (!u) return t("Leggo la call…");
  if (u.waitUntil !== null && u.waitUntil > nowMs) {
    const s = Math.max(1, Math.ceil((u.waitUntil - nowMs) / 1000));
    return t("attendo il limite al minuto del modello · {s} s", { s });
  }
  if (u.steps > 1 && u.step < u.steps - 1) return t("parte {i} di {n}", { i: u.step + 1, n: u.steps - 1 });
  return t("scrivo sintesi e cose da fare");
}
