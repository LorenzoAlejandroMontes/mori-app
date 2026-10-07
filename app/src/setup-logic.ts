// First launch of a packaged Mori: the recorder and Whisper need a Python
// environment, and Mori prepares it by itself (src-tauri/src/pyenv.rs). This is
// what the interface says meanwhile. Pure: no React, no Tauri, so
// scripts/checks.mjs runs it as is.
import { t } from "./i18n";

/** The steps the backend goes through, in order (`setup://progress`). */
export type SetupStage = "python" | "packages" | "check";
export const SETUP_STAGES: SetupStage[] = ["python", "packages", "check"];

export type SetupState =
  /** Not asked yet, or a Mori that never prepares anything (built from source). */
  | { phase: "idle" }
  | { phase: "preparing"; stage: SetupStage }
  | { phase: "failed"; error: string }
  | { phase: "ready" };

/** How far along, for the line that fills: a third per step, never full before the end. */
export function setupFraction(stage: SetupStage): number {
  return (SETUP_STAGES.indexOf(stage) + 0.5) / SETUP_STAGES.length;
}

/** "2 di 3 · audio e trascrizione": where it is, in words. */
export function setupLine(stage: SetupStage): string {
  const n = SETUP_STAGES.indexOf(stage) + 1;
  const what =
    stage === "python"
      ? t("scarico Python")
      : stage === "packages"
        ? t("audio e trascrizione")
        : t("controllo finale");
  return t("{n} di {total} · {what}", { n, total: SETUP_STAGES.length, what });
}

/** The backend's stage name, or null for anything else it may send one day. */
export function parseStage(v: unknown): SetupStage | null {
  return SETUP_STAGES.includes(v as SetupStage) ? (v as SetupStage) : null;
}
