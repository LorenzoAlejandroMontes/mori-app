// The live state of the transcription in progress, for every view at once
// (sidebar, call page, pill). Polls only while Whisper is actually working,
// once a second: the file it reads is a few bytes, rewritten twice a second.
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribeJobs, transcribingNow } from "./jobs";
import { estimate, parseProgress, type Progress, type RawProgress } from "./progress-logic";
import { subscribeUnderstanding, understandingNow, type Understanding } from "./organize";

export type LiveProgress = Progress & { sessionId: string };

let state: LiveProgress | null = null;
let raw: RawProgress | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let watching = "";
const listeners = new Set<() => void>();

function emit(next: LiveProgress | null) {
  const same =
    state && next &&
    state.sessionId === next.sessionId && state.stage === next.stage &&
    state.fraction === next.fraction && state.etaSecs === next.etaSecs;
  if (same || (!state && !next)) return;
  state = next;
  for (const cb of [...listeners]) cb();
}

async function poll() {
  const cur = transcribingNow();
  if (!cur) return;
  try {
    const text = await invoke<string | null>("transcribe_progress", { wav: cur.wav });
    const r = parseProgress(text);
    if (r) raw = r;
  } catch {
    /* an older backend without the command: the line stays indeterminate */
  }
  if (transcribingNow()?.wav !== cur.wav) return;
  const p = estimate(raw, Date.now());
  // Rounded so the views re-render when something visible changes, not on
  // every poll: a whole percent, and the ETA to ten seconds.
  emit({
    sessionId: cur.sessionId,
    stage: p.stage,
    fraction: p.fraction === null ? null : Math.round(p.fraction * 100) / 100,
    etaSecs: p.etaSecs === null ? null : Math.round(p.etaSecs / 10) * 10,
  });
}

function sync() {
  const cur = transcribingNow();
  const key = cur ? `${cur.sessionId}|${cur.wav}` : "";
  if (key === watching) return;
  watching = key;
  raw = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (!cur) {
    emit(null);
    return;
  }
  emit({ sessionId: cur.sessionId, stage: "load", fraction: null, etaSecs: null });
  void poll();
  timer = setInterval(() => void poll(), 1000);
}

let unsubJobs: (() => void) | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!unsubJobs) {
    unsubJobs = subscribeJobs(sync);
    sync();
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && unsubJobs) {
      unsubJobs();
      unsubJobs = null;
      if (timer) clearInterval(timer);
      timer = null;
      watching = "";
    }
  };
}

/** The transcription Whisper is on, with how far and how long; null at rest. */
export function useTranscribeProgress(): LiveProgress | null {
  return useSyncExternalStore(subscribe, () => state);
}

/** The call Mori is understanding (organize), with its piece and any pause;
 *  re-rendered every second while a pause is counting down. */
export function useUnderstanding(): Understanding | null {
  const u = useSyncExternalStore(subscribeUnderstanding, understandingNow);
  const [, tick] = useState(0);
  const waiting = !!u?.waitUntil;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  return u;
}
