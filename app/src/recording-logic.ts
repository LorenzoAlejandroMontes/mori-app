// What the recorder hears, live, and whether one side has gone dead. Pure: no
// React, no Tauri, so scripts/checks.mjs runs it as is. The numbers come from
// `<wav>.levels`, rewritten by record.py about twice a second.
//
// Why it exists: the other side of a call is the PC's audio (WASAPI loopback of
// the DEFAULT output). A call routed to Bluetooth headphones that are not the
// default device, or a mic muted in Windows, records an hour of silence on one
// channel — and nobody found out until the transcript came back half empty.
import { t } from "./i18n";

export type Levels = {
  /** Loudness (RMS, 0…1) of the last block on each channel. */
  mic: number;
  sys: number;
  /** Seconds since each channel last had signal. */
  micQuiet: number;
  sysQuiet: number;
  /** Capture threads that died ("mic: …", "sys: …"). */
  errs: string[];
};

export function parseLevels(text: string | null | undefined): Levels | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    return {
      mic: n(j.mic),
      sys: n(j.sys),
      micQuiet: n(j.mic_quiet),
      sysQuiet: n(j.sys_quiet),
      errs: Array.isArray(j.errs) ? j.errs.map(String) : [],
    };
  } catch {
    return null;
  }
}

export type ChannelIssue = "mic-error" | "sys-error" | "sys-silent" | "mic-silent" | null;

/** One side silent this long, while the other talks, is not a pause. */
export const DEAD_AFTER_S = 45;
/** "The other one talks": had signal this recently. */
const TALKING_WITHIN_S = 20;

export function channelIssue(l: Levels | null, elapsedSecs: number): ChannelIssue {
  if (!l) return null;
  // A dead capture is said at once: nothing more will come from that side.
  if (l.errs.some((e) => e.startsWith("mic"))) return "mic-error";
  if (l.errs.some((e) => e.startsWith("sys"))) return "sys-error";
  if (elapsedSecs < DEAD_AFTER_S) return null;
  // Both quiet is a pause or the end of the call: the auto-stop handles that.
  if (l.sysQuiet >= DEAD_AFTER_S && l.micQuiet < TALKING_WITHIN_S) return "sys-silent";
  if (l.micQuiet >= DEAD_AFTER_S && l.sysQuiet < TALKING_WITHIN_S) return "mic-silent";
  return null;
}

/** What to say, and what to check: short enough for the capsule and the pill. */
export function issueText(issue: Exclude<ChannelIssue, null>): { title: string; hint: string } {
  switch (issue) {
    case "sys-silent":
      return {
        title: t("Non sento l'altra parte"),
        hint: t("La call esce da un altro dispositivo? Mori ascolta l'uscita audio predefinita di Windows."),
      };
    case "mic-silent":
      return {
        title: t("Non ti sento"),
        hint: t("Il microfono è muto, o la call usa un altro microfono? Mori ascolta quello predefinito di Windows."),
      };
    case "mic-error":
      return {
        title: t("Il microfono si è fermato"),
        hint: t("Si è staccato o è cambiato: la tua voce non si registra più. Ferma e riparti."),
      };
    case "sys-error":
      return {
        title: t("L'audio del PC si è fermato"),
        hint: t("Il dispositivo di uscita è cambiato: l'altra parte non si registra più. Ferma e riparti."),
      };
  }
}

/** Loudness → 0…1 for the wave, on a decibel scale: speech sits mid-high,
 *  the silence threshold (0.01 ≈ −40 dB) barely moves it. */
export function waveLevel(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 45) / 35));
}
