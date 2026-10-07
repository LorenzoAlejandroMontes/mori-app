// Il lato frontend del compagno: impostazioni (scorciatoia, barra, silenzio,
// "come mi chiamo"), la pillola sempre in primo piano e la sorveglianza del
// silenzio durante una registrazione.
//
// Qui non si registra e non si ferma niente: si chiede al frontend principale
// di chiamare il suo `toggleRecord`, che ha già le guardie contro il doppio stop.

import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { DEFAULT_MY_NAMES, parseMyNames } from "./views/todo-logic";
import { t } from "./i18n";
import { issueText, type ChannelIssue } from "./recording-logic";
import { defaultHotkey } from "./ui/platform";
import { progressLine, understandFraction, understandLine, type Progress, type UnderstandState } from "./progress-logic";

export const DEFAULT_HOTKEY = defaultHotkey();
export const DEFAULT_SILENCE_MIN = 8;
export const COUNTDOWN_SECS = 60;

export type CompanionSettings = {
  hotkey: string;
  closeToTray: boolean;
  /** Minuti di silenzio dopo i quali Mori propone di fermarsi. 0 = mai. */
  silenceMin: number;
  /** I nomi con cui le call chiamano l'utente, per dividere "Mie"/"Degli altri". */
  myNames: string[];
};

const DEFAULTS: CompanionSettings = {
  hotkey: DEFAULT_HOTKEY,
  closeToTray: true,
  silenceMin: DEFAULT_SILENCE_MIN,
  myNames: DEFAULT_MY_NAMES,
};

let _cache: CompanionSettings | null = null;

export function getCompanionSettings(): CompanionSettings {
  return _cache ?? { ...DEFAULTS, myNames: [...DEFAULT_MY_NAMES] };
}

async function readSetting(key: string): Promise<string | null> {
  const d = await db();
  const rows = await d.select<{ value: string }[]>(`SELECT value FROM app_setting WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT INTO app_setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value],
  );
}

/** Legge le impostazioni e le applica subito al backend (scorciatoia, barra). */
export async function loadCompanionSettings(): Promise<CompanionSettings> {
  let next: CompanionSettings = { ...DEFAULTS, myNames: [...DEFAULT_MY_NAMES] };
  try {
    const [hotkey, closeTray, silence, names] = await Promise.all([
      readSetting("companion_hotkey"),
      readSetting("companion_close_tray"),
      readSetting("companion_silence_min"),
      readSetting("companion_my_names"),
    ]);
    const mins = Number.parseInt(silence ?? "", 10);
    next = {
      hotkey: hotkey?.trim() || DEFAULT_HOTKEY,
      closeToTray: closeTray === null ? true : closeTray !== "0",
      silenceMin: Number.isFinite(mins) && mins >= 0 ? mins : DEFAULT_SILENCE_MIN,
      myNames: parseMyNames(names),
    };
  } catch {
    /* prima apertura o DB non ancora pronto: restano i default */
  }
  _cache = next;
  await applyToBackend(next);
  return next;
}

/** Applica le impostazioni al backend. Torna un avviso da mostrare, o null. */
async function applyToBackend(s: CompanionSettings): Promise<string | null> {
  let warn: string | null = null;
  try {
    await invoke("companion_set_hotkey", { accel: s.hotkey });
  } catch (e) {
    // Combinazione non valida o già presa: il backend rimette quella di prima,
    // ma va detto, altrimenti si preme un tasto che non fa niente.
    warn = String(e).replace(/^Error:\s*/, "");
  }
  try {
    // Il menu dell'icona nella lingua dell'interfaccia (il backend parte in inglese).
    await invoke("companion_set_labels", {
      labels: {
        record: t("Registra la call"),
        stop: t("Ferma e trascrivi"),
        open: t("Apri Mori"),
        quit: t("Esci"),
        quit_recording: t("Esci · fermo la registrazione"),
        tip_recording: t("Mori · sto registrando"),
      },
    });
  } catch {
    /* backend più vecchio: il menu resta com'è */
  }
  try {
    await invoke("companion_set_close_to_tray", { on: s.closeToTray });
  } catch {
    /* niente icona nella barra: il backend ignora e la finestra chiude come prima */
  }
  return warn;
}

/** Salva e applica. Torna un avviso da mostrare all'utente, o null. */
export async function saveCompanionSettings(s: CompanionSettings): Promise<string | null> {
  _cache = s;
  await Promise.all([
    writeSetting("companion_hotkey", s.hotkey.trim() || DEFAULT_HOTKEY),
    writeSetting("companion_close_tray", s.closeToTray ? "1" : "0"),
    writeSetting("companion_silence_min", String(s.silenceMin)),
    writeSetting("companion_my_names", s.myNames.join(", ")),
  ]);
  return applyToBackend(s);
}

/** Vero se l'icona nella barra esiste davvero (non si promette ciò che non c'è). */
export async function trayReady(): Promise<boolean> {
  try {
    return await invoke<boolean>("companion_tray_ready");
  } catch {
    return false;
  }
}

// --- La pillola --------------------------------------------------------------

export type PillKind = "started" | "stopped" | "info" | "silence" | "status";
export type Pill = {
  kind: PillKind;
  title: string;
  subtitle?: string;
  hint?: string;
  seconds?: number;
  phase?: StatusPhase;
  since?: number;
  /** Solo per "status" in trascrizione: 0…1, o -1 se non si sa ancora. */
  progress?: number;
};

// Una sola finestrella, tre usi. In ordine di precedenza:
//   1. "hold": resta finché qualcuno non chiama hidePill (silenzio, "Chiudo Mori");
//   2. "flash": conferma di qualche secondo (avviata, fermata);
//   3. il riquadro di stato: registro / salvo / trascrivo, finché c'è lavoro
//      in corso e la finestra principale non è quella davanti.
// Quando 1 e 2 finiscono, si torna al 3, o si chiude se non c'è niente.
let _overlay: "hold" | "flash" | null = null;
let _status: Pill | null = null;
let _sent: string | null = null;

async function send(pill: Pill): Promise<void> {
  const full = { seconds: 0, subtitle: "", hint: "", phase: "", since: 0, progress: -1, ...pill };
  _sent = JSON.stringify(full);
  try {
    await invoke("companion_pill", { pill: full });
  } catch {
    /* la finestrella non è essenziale: se non si apre, si registra lo stesso */
  }
}

/** Nessuna conferma in primo piano: mostra lo stato, o chiudi. */
async function settle(): Promise<void> {
  if (_overlay) return;
  if (_status) {
    // Stesso stato di prima: niente evento (il timer lo tiene la finestrella).
    if (_sent === JSON.stringify({ seconds: 0, subtitle: "", hint: "", phase: "", since: 0, progress: -1, ..._status })) return;
    await send(_status);
    return;
  }
  _sent = null;
  try {
    await invoke("companion_pill_hide");
  } catch {
    /* ignore */
  }
}

export async function showPill(pill: Pill): Promise<void> {
  _overlay = "hold";
  await send(pill);
}

export async function hidePill(): Promise<void> {
  _overlay = null;
  await settle();
}

/** Mostra la conferma per qualche secondo e poi torna allo stato (o chiude). */
let _autoHide: ReturnType<typeof setTimeout> | null = null;
export async function flashPill(pill: Pill, ms = 2600): Promise<void> {
  if (_autoHide) clearTimeout(_autoHide);
  _overlay = "flash";
  await send(pill);
  _autoHide = setTimeout(() => {
    _autoHide = null;
    if (_overlay === "flash") void hidePill();
  }, ms);
}

/** Annulla l'auto-chiusura (serve prima di mostrare il conto alla rovescia). */
export function cancelPillAutoHide(): void {
  if (_autoHide) clearTimeout(_autoHide);
  _autoHide = null;
}

// --- Il riquadro di stato ----------------------------------------------------

export type StatusPhase = "recording" | "saving" | "transcribing" | "understanding";
export type Activity = {
  phase: StatusPhase;
  since?: number;
  queued?: number;
  /** How far Whisper is on the call being transcribed (src/progress.ts). */
  progress?: Progress | null;
  /** Where organize is, once the words are in (src/organize.ts). */
  understanding?: UnderstandState | null;
  /** While recording: a side has gone dead (src/recording-logic.ts). */
  issue?: ChannelIssue;
};

/** Il riquadro di stato per quello che sta facendo Mori, o null a riposo. */
export function statusPill(a: Activity | null): Pill | null {
  if (!a) return null;
  if (a.phase === "recording") {
    // A dead side goes in the pill too: with Mori behind, it is the only place.
    const warn = a.issue ? issueText(a.issue).title : "";
    return { kind: "status", phase: "recording", title: t("Registro"), since: a.since ?? Date.now(), hint: warn };
  }
  if (a.phase === "saving") return { kind: "status", phase: "saving", title: t("Salvo la registrazione") };
  if (a.phase === "understanding") {
    return {
      kind: "status",
      phase: "understanding",
      title: t("Capisco la call"),
      subtitle: understandLine(a.understanding ?? null, Date.now()),
      progress: a.understanding ? understandFraction(a.understanding) : -1,
    };
  }
  const more = (a.queued ?? 1) - 1;
  const line = progressLine(a.progress ?? null);
  return {
    kind: "status",
    phase: "transcribing",
    title: t("Trascrivo la call"),
    subtitle: more > 0 ? `${line} · ${t("+{n} in coda", { n: more })}` : line,
    progress: a.progress?.fraction ?? -1,
  };
}

/**
 * Cosa sta facendo Mori e se la sua finestra è davanti. Il riquadro compare
 * solo se c'è lavoro in corso E la finestra non è quella attiva (ridotta, nella
 * barra o dietro un'altra app): a Mori aperto lo stato si vede già dentro.
 */
export function setStatus(a: Activity | null, mainFocused: boolean): void {
  _status = mainFocused ? null : statusPill(a);
  void settle();
}

export async function setTrayRecording(on: boolean): Promise<void> {
  try {
    await invoke("companion_set_recording", { on });
  } catch {
    /* ignore */
  }
}

/**
 * La registrazione fermata è al sicuro (call creata e trascrizione in coda, o
 * errore mostrato): il backend può smettere di trattenere "Esci".
 */
export async function recordingSettled(): Promise<void> {
  try {
    await invoke("companion_recording_settled");
  } catch {
    /* ignore */
  }
}

export async function quitApp(): Promise<void> {
  try {
    await invoke("companion_quit");
  } catch {
    /* ignore */
  }
}

// --- Silenzio ----------------------------------------------------------------

/** Secondi di silenzio continuo sui due canali, 0 se il file non c'è. */
export async function silenceSecs(wav: string): Promise<number> {
  try {
    return await invoke<number>("recording_silence_secs", { wav });
  } catch {
    return 0;
  }
}

// La decisione vera è pura e vive in companion-logic.ts, dove può essere
// eseguita da riga di comando senza avviare l'app.
export { silenceDecision } from "./companion-logic";
