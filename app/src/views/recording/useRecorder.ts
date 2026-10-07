// Recording: start/stop with its guards, the timer, the silence watch and its
// countdown, the tray and the always-on-top pill, "Esci" while recording.
// Moved here from App.tsx as is: the guards are subtle and were verified long.
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { channelIssue, parseLevels, type ChannelIssue, type Levels } from "../../recording-logic";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enqueueJob, pumpJobs, type SessionJob } from "../../jobs";
import { addRecordingPlaceholder } from "../../ingest";
import { startRecording, stopRecording, buildVocab, getWhisperModel, type RecPaths } from "../../recorder";
import {
  setTrayRecording,
  flashPill,
  showPill,
  hidePill,
  cancelPillAutoHide,
  silenceSecs,
  silenceDecision,
  quitApp,
  recordingSettled,
  setStatus,
  COUNTDOWN_SECS,
} from "../../companion";
import { fmtClock } from "../../ui/format";
import { useTranscribeProgress, useUnderstanding } from "../../progress";
import { understandLine } from "../../progress-logic";
import { t, tn } from "../../i18n";

export type Recorder = {
  recording: RecPaths | null;
  recSecs: number;
  /** start_recording is running (it can take seconds to bring record.py up). */
  starting: boolean;
  saving: boolean;
  recError: string | null;
  /** Seconds left before the auto-stop, or null when not counting down. */
  silenceLeft: number | null;
  /** The main window is the one in front (else the pill shows the state). */
  mainFocused: boolean;
  /** What each side sounds like right now (null before record.py says). */
  levels: Levels | null;
  /** One side has gone dead (or its capture died): say it while it can be fixed. */
  issue: ChannelIssue;
  toggleRecord: () => Promise<void>;
  keepRecording: () => void;
  stopNow: () => void;
};

export function useRecorder({
  hotkey,
  silenceMin,
  jobs,
  onSaved,
}: {
  hotkey: string;
  silenceMin: number;
  jobs: Record<string, SessionJob>;
  /** The call now exists (as "transcribing"): show it. */
  onSaved: (id: string) => Promise<void>;
}): Recorder {
  const [recording, setRecording] = useState<RecPaths | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const recBusyRef = useRef(false);
  // Live mirror of `recording`, written only by toggleRecord (the only place
  // that calls setRecording), synchronously — never waits for a render.
  const recordingRef = useRef<RecPaths | null>(null);
  /**
   * L'avvio o lo stop in corso, se ce n'è uno: "Esci" aspetta che finisca
   * (record.py partito davvero, oppure call salvata e messa in coda).
   */
  const toggleInflight = useRef<Promise<void> | null>(null);
  /**
   * "Esci" è stato chiesto: la call si mette in coda ma la trascrizione non si
   * avvia, perché l'app si chiude un attimo dopo e la lascerebbe a metà. La
   * coda la riprende al prossimo avvio.
   */
  const quitting = useRef(false);

  // Conto alla rovescia dello stop automatico: null = non attivo.
  const [silenceLeft, setSilenceLeft] = useState<number | null>(null);
  // La finestra principale è quella davanti? Se no, lo stato va nel riquadro
  // sempre in primo piano (vedi setStatus).
  const [mainFocused, setMainFocused] = useState(true);
  // Read by effects that must not re-run when focus changes (see below).
  const mainFocusedRef = useRef(true);
  mainFocusedRef.current = mainFocused;
  const silenceLeftRef = useRef<number | null>(null);
  const recStartedAt = useRef(0);
  const silenceArmed = useRef(false);
  /** L'utente ha detto "continua a registrare": si tace finché non riparla. */
  const silenceSnoozed = useRef(false);
  const prevRecording = useRef<RecPaths | null>(null);
  const autoStopping = useRef(false);

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // toggleRecord viene ricreato a ogni render e si porta dentro `recording` e
  // `saving`. Un listener registrato una volta sola congelerebbe la versione del
  // primo render: premendo la scorciatoia durante una registrazione proverebbe
  // ad avviarne una seconda invece di fermare. Questo riferimento punta sempre
  // all'ultima versione. La guardia contro la doppia pressione (avvia e ferma)
  // vive dentro toggleRecord, quindi vale anche per chi passa da qui.
  const toggleRef = useRef(toggleRecord);
  toggleRef.current = toggleRecord;

  // Scorciatoia globale e voce "Registra" del menu della barra: il backend
  // chiede, la decisione resta qui dove vivono le guardie di toggleRecord.
  useEffect(() => {
    const un = listen("companion://toggle-record", () => {
      void toggleRef.current();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // "Esci" dal menu della barra mentre registra: prima si ferma, poi si esce.
  // Vale anche nelle due finestre in cui `recording` è nullo ma c'è lavoro a
  // metà: l'avvio (record.py già lanciato, si aspetta che parta) e il
  // salvataggio (WAV in scrittura, call non ancora in coda).
  useEffect(() => {
    const un = listen("companion://quit-request", async () => {
      quitting.current = true;
      const pending = toggleInflight.current;
      if (pending || recordingRef.current) {
        // Su una call lunga la scrittura finale del WAV può prendere minuti:
        // si dice cosa sta succedendo invece di sembrare bloccati.
        cancelPillAutoHide();
        await showPill({
          kind: "info",
          title: t("Chiudo Mori"),
          subtitle: t("prima finisco di salvare la registrazione"),
        });
      }
      // runToggle non lancia: gli errori finiscono in recError.
      while (toggleInflight.current) await toggleInflight.current;
      // Dopo un avvio appena concluso la registrazione è viva: va fermata.
      if (recordingRef.current) await toggleRef.current();
      await quitApp();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Icona della barra + conferma sopra tutto quando parte o si ferma. La
  // conferma nella finestrella serve solo se Mori non è davanti: altrimenti lo
  // dice già il controllo nella barra laterale, e due conferme sono una di
  // troppo (docs/DESIGN.md §4).
  useEffect(() => {
    const was = prevRecording.current;
    prevRecording.current = recording;
    if (!was && recording) {
      void setTrayRecording(true);
      if (mainFocusedRef.current) return;
      void flashPill({
        kind: "started",
        title: t("Registrazione avviata"),
        subtitle: t("Tu e l'interlocutore"),
        hint: t("{key} per fermare", { key: hotkey }),
      });
    } else if (was && !recording) {
      void setTrayRecording(false);
      silenceArmed.current = false;
      silenceSnoozed.current = false;
      setSilenceLeft(null);
      if (mainFocusedRef.current) return;
      void flashPill({
        kind: "stopped",
        title: t("Registrazione fermata"),
        subtitle: t("{time} · la sto trascrivendo", {
          time: fmtClock(Math.max(0, Math.floor((Date.now() - recStartedAt.current) / 1000))),
        }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Sorveglianza del silenzio: record.py riscrive `<wav>.silence` ogni ~5 s.
  useEffect(() => {
    if (!recording || silenceMin <= 0) return;
    let alive = true;
    const wav = recording.wav;
    const check = async () => {
      const s = await silenceSecs(wav);
      if (!alive) return;
      const d = silenceDecision({
        silence: s,
        thresholdMin: silenceMin,
        armed: silenceArmed.current,
        snoozed: silenceSnoozed.current,
      });
      if (d === "unsnooze") {
        // Qualcuno ha riparlato: da qui in poi si può tornare a proporre.
        silenceSnoozed.current = false;
      } else if (d === "arm") {
        silenceArmed.current = true;
        // With Mori in front the countdown is in the sidebar; behind, in the
        // pill: the effect on `counting` below puts it in the right place.
        setSilenceLeft(COUNTDOWN_SECS);
      } else if (d === "disarm") {
        silenceArmed.current = false;
        setSilenceLeft(null);
        void hidePill();
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [recording, silenceMin]);

  // Il conto alla rovescia vero e proprio: a zero si ferma passando dal solito
  // toggleRecord, con le sue guardie.
  useEffect(() => {
    if (silenceLeft === null || !recording) return;
    if (silenceLeft <= 0) {
      if (autoStopping.current) return;
      autoStopping.current = true;
      silenceArmed.current = false;
      setSilenceLeft(null);
      void hidePill();
      void toggleRef.current().finally(() => {
        autoStopping.current = false;
      });
      return;
    }
    const timer = setTimeout(() => setSilenceLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenceLeft, recording]);

  function showSilencePill(seconds: number) {
    cancelPillAutoHide();
    void showPill({
      kind: "silence",
      title: t("Sembra finita"),
      subtitle: tn(
        silenceMin,
        "1 minuti senza una parola, da nessuno dei due lati. Fermo e mando in trascrizione.",
        "{n} minuti senza una parola, da nessuno dei due lati. Fermo e mando in trascrizione.",
      ),
      seconds,
    });
  }

  // The countdown follows the window: Mori goes behind → the pill shows it;
  // Mori comes back → the pill goes, the sidebar has it.
  silenceLeftRef.current = silenceLeft;
  const counting = silenceLeft !== null && silenceLeft > 0;
  useEffect(() => {
    if (!counting) return;
    if (mainFocused) void hidePill();
    else showSilencePill(silenceLeftRef.current ?? COUNTDOWN_SECS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting, mainFocused]);

  /**
   * "Continua a registrare": annulla il conto alla rovescia e non ripropone
   * niente finché qualcuno non riparla davvero. Senza questo, restando in
   * silenzio la proposta tornerebbe al controllo dopo (cinque secondi).
   */
  function keepRecording() {
    silenceArmed.current = false;
    silenceSnoozed.current = true;
    setSilenceLeft(null);
    void hidePill();
  }

  /** "Ferma adesso" during the countdown: the countdown reaches zero now. */
  function stopNow() {
    silenceArmed.current = false;
    setSilenceLeft(0);
  }

  // I due bottoni della pillola. Senza dipendenze: un'azione che arriva mentre
  // l'effetto si ri-registra andrebbe persa.
  useEffect(() => {
    const un = listen<string>("companion://pill-action", (e) => {
      if (e.payload === "keep") keepRecording();
      else if (e.payload === "toggle") void toggleRef.current();
      else if (e.payload === "stop") {
        silenceArmed.current = false;
        setSilenceLeft(0);
      }
    });
    return () => {
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = getCurrentWindow();
    w.isFocused().then(setMainFocused).catch(() => {});
    const un = w.onFocusChanged(({ payload }) => setMainFocused(payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // The two voices, live: record.py rewrites `<wav>.levels` ~twice a second.
  // Read twice a second too — the wave follows real voices, and a side that
  // stays silent while the other talks is said during the call, not after.
  const [levels, setLevels] = useState<Levels | null>(null);
  useEffect(() => {
    if (!recording) {
      setLevels(null);
      return;
    }
    let alive = true;
    const wav = recording.wav;
    const read = async () => {
      try {
        const l = parseLevels(await invoke<string | null>("recording_levels", { wav }));
        if (alive && l) setLevels(l);
      } catch {
        /* an older backend: the wave just animates on its own */
      }
    };
    void read();
    const timer = setInterval(read, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [recording]);
  const issue = recording ? channelIssue(levels, recSecs) : null;

  // Il riquadro di stato: registro > salvo > trascrivo, oppure niente.
  const transcribing = Object.values(jobs).filter(
    (j) => j.kind === "transcribe" && (j.status === "running" || j.status === "pending"),
  ).length;
  const understanding = useUnderstanding();
  const phase = recording
    ? "recording"
    : saving
      ? "saving"
      : transcribing > 0
        ? "transcribing"
        : understanding
          ? "understanding"
          : null;
  const progress = useTranscribeProgress();
  // The pill counts a pause down by itself would need the main window's clock:
  // the line is rebuilt here on each tick of useUnderstanding instead.
  const undKey = understanding ? `${understanding.step}/${understanding.steps}/${understanding.waitUntil ? understandLine(understanding, Date.now()) : ""}` : "";
  useEffect(() => {
    setStatus(
      phase ? { phase, since: recStartedAt.current, queued: transcribing, progress, understanding, issue } : null,
      mainFocused,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, transcribing, mainFocused, progress, undKey, issue]);

  // The timer is read from the wall clock, not counted: a hidden or minimized
  // window (Mori in the tray during a call) gets its timers throttled, and a
  // counter of ticks fell minutes behind on a long call — then the "fermata"
  // confirmation reported the wrong length.
  useEffect(() => {
    if (!recording) return;
    const tick = () => setRecSecs(Math.max(0, Math.floor((Date.now() - recStartedAt.current) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Tiene in mano la promessa del toggle in corso: "Esci" la aspetta, così non
  // chiude a metà di un avvio (record.py orfano) o di un salvataggio (call
  // persa). La guardia contro la doppia pressione resta `recBusyRef`, dentro.
  async function toggleRecord() {
    if (toggleInflight.current) return;
    const run = runToggle();
    toggleInflight.current = run;
    try {
      await run;
    } finally {
      toggleInflight.current = null;
    }
  }

  async function runToggle() {
    if (saving) return;
    // Synchronous re-entry guard on BOTH branches, so it covers every caller
    // (buttons, Cmd+K, call banner, hotkey, tray menu, auto-stop, quit).
    // Stop: two fast clicks (overlay + sidebar) must not both stop → they would
    // start two transcriptions of the same recording.
    // Start: start_recording can block up to 10 s waiting for record.py to come
    // up; a second press in that window would spawn a SECOND recorder whose
    // setRecording overwrites the first, leaving it alive with no way to stop it.
    if (recBusyRef.current) return;
    recBusyRef.current = true;
    // The branch is picked from the ref, not from `recording`: when the guard
    // is released this closure can still be one render old, the ref never is.
    const paths = recordingRef.current;
    try {
      if (paths) {
        recordingRef.current = null;
        setRecording(null);
        setSaving(true);
        setRecError(null);
        try {
          // Fast: stop + wait for the WAV to be saved (no transcription here).
          const wav = await stopRecording(paths);
          const d = new Date();
          const title = `Registrazione ${d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
          // Show the call immediately as "transcribing" — the app stays free.
          const id = await addRecordingPlaceholder(title);
          // Hand the rest to the durable queue: transcribe → organize survive a
          // crash, a failed LLM call and a closed app, and can be retried.
          await enqueueJob("transcribe", id, { wav, model: getWhisperModel(), vocab: await buildVocab() });
          await onSavedRef.current(id);
          if (!quitting.current) void pumpJobs();
        } catch (e) {
          setRecError(String(e));
        } finally {
          setSaving(false);
          // La call è al sicuro (o è fallita e l'errore è a schermo): da qui
          // "Esci" può tornare immediato.
          await recordingSettled();
        }
      } else {
        setRecError(null);
        setStarting(true);
        try {
          const p = await startRecording();
          recStartedAt.current = Date.now();
          setRecSecs(0);
          recordingRef.current = p;
          setRecording(p);
        } catch (e) {
          setRecError(String(e));
        } finally {
          setStarting(false);
        }
      }
    } finally {
      recBusyRef.current = false;
    }
  }

  return {
    recording,
    recSecs,
    starting,
    saving,
    recError,
    silenceLeft,
    mainFocused,
    levels,
    issue,
    toggleRecord,
    keepRecording,
    stopNow,
  };
}
