// THE recording control, at the top of the sidebar: the same element goes
// through every state — ready, starting, recording, saving — so there is one
// place to look at to know whether Mori is listening (docs/DESIGN.md §4).
import { fmtClock } from "../../ui/format";
import { hotkeyParts } from "../../ui/keys";
import VoicesWave from "./VoicesWave";
import { issueText, waveLevel, type ChannelIssue, type Levels } from "../../recording-logic";
import { t } from "../../i18n";

export type RecState = "idle" | "starting" | "recording" | "saving";

export function recState(r: { recording: unknown; starting: boolean; saving: boolean }): RecState {
  return r.recording ? "recording" : r.saving ? "saving" : r.starting ? "starting" : "idle";
}

export default function RecordControl({
  state,
  secs,
  hotkey,
  error,
  silenceLeft,
  onToggle,
  onKeep,
  onStopNow,
  levels = null,
  issue = null,
}: {
  state: RecState;
  secs: number;
  hotkey: string;
  error: string | null;
  /** Seconds before the auto-stop, or null. */
  silenceLeft: number | null;
  onToggle: () => void;
  onKeep: () => void;
  onStopNow: () => void;
  /** What each side sounds like now, and whether one has gone dead. */
  levels?: Levels | null;
  issue?: ChannelIssue;
}) {
  return (
    <div className={"rec-ctl " + state} data-rec={state}>
      {state === "idle" && (
        <button className="rec-main" onClick={onToggle}>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-label">{t("Registra la call")}</span>
          <span className="rec-key mono" aria-hidden="true">{hotkeyParts(hotkey).join(" ")}</span>
        </button>
      )}
      {state === "starting" && (
        <div className="rec-main" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="rec-label">{t("Avvio la registrazione…")}</span>
        </div>
      )}
      {state === "recording" && (
        <div className="rec-live" role="group" aria-label={t("Registrazione in corso")}>
          <div className="rec-live-top">
            <span className="rec-dot live" aria-hidden="true" />
            <span className="rec-label">{t("Registro")}</span>
            <span className="rec-time mono" aria-label={t("da {time}", { time: fmtClock(secs) })}>{fmtClock(secs)}</span>
          </div>
          <div className="rec-live-bottom">
            <VoicesWave mic={levels ? waveLevel(levels.mic) : undefined} sys={levels ? waveLevel(levels.sys) : undefined} />
            <button className="rec-stop" onClick={onToggle} title={t("Ferma e trascrivi")}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
              {t("Ferma")}
            </button>
          </div>
          {issue && <ChannelWarning issue={issue} />}
          {silenceLeft !== null && <SilencePrompt left={silenceLeft} onKeep={onKeep} onStopNow={onStopNow} />}
        </div>
      )}
      {state === "saving" && (
        <div className="rec-main" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="rec-label">{t("Salvo la registrazione…")}</span>
        </div>
      )}
      {error && (
        <div className="rec-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** One side has gone dead: said inside the capsule, while it can be fixed. */
function ChannelWarning({ issue }: { issue: Exclude<ChannelIssue, null> }) {
  const { title, hint } = issueText(issue);
  return (
    <div className="rec-warn" role="alert">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 2 20h20L12 3z" />
        <path d="M12 10v4M12 17.5v.01" />
      </svg>
      <span>
        <b>{title}</b>
        <span className="rec-warn-hint">{hint}</span>
      </span>
    </div>
  );
}

/**
 * "Sembra finita": the auto-stop countdown, inside the control (or in a toast
 * when the sidebar is collapsed). Screen readers hear it once, not every second.
 */
export function SilencePrompt({
  left,
  onKeep,
  onStopNow,
  total = 60,
}: {
  left: number;
  onKeep: () => void;
  onStopNow: () => void;
  total?: number;
}) {
  // One sentence around the countdown, so the translation keeps its word order.
  const [before, after = ""] = t("Sembra finita: fermo tra {left}").split("{left}");
  return (
    <div className="silence" role="alert">
      <p className="silence-msg">
        <span className="sr-only">{t("Sembra finita: tra un minuto fermo la registrazione e la trascrivo.")}</span>
        <span aria-hidden="true">
          {before}
          <b className="mono">{left} s</b>
          {after}
        </span>
      </p>
      <div className="silence-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, left / total))})` }} />
      </div>
      <div className="silence-acts">
        <button className="btn sm primary" onClick={onKeep}>
          {t("Continua")}
        </button>
        <button className="btn sm" onClick={onStopNow}>
          {t("Ferma ora")}
        </button>
      </div>
    </div>
  );
}
