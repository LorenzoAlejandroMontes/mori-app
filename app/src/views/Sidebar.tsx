// The left side of the window (docs/DESIGN.md §2): destinations on top, the
// calls you just touched underneath, settings at the bottom. Collapsed, the
// same things in the same order as an icon rail.
import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "../db";
import type { SessionJob } from "../jobs";
import { Wordmark } from "../ui/Mark";
import { fmtClock, fmtDate } from "../ui/format";
import { hotkeyParts } from "../ui/keys";
import {
  IconAlert,
  IconCalls,
  IconChat,
  IconKeyboard,
  IconPeople,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconToday,
  IconTodo,
  LockIcon,
} from "../ui/icons";
import RecordControl, { type RecState } from "./recording/RecordControl";
import type { ChannelIssue, Levels } from "../recording-logic";
import { WorkStrip } from "./recording/TranscribeProgress";
import { useTranscribeProgress, useUnderstanding } from "../progress";
import { progressLine, understandFraction, understandLine } from "../progress-logic";
import { t } from "../i18n";
import "./Sidebar.css";

export type View = "home" | "chat" | "session" | "history" | "todos" | "person" | "settings";
type Section = "home" | "chat" | "todos" | "person" | "history";

/** The five sections, in order: Ctrl+1…5 follow this list. */
export const SECTIONS: { id: Section; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "home", label: t("Oggi"), icon: IconToday },
  { id: "chat", label: t("Chiedi a Mori"), icon: IconChat },
  { id: "todos", label: t("Da fare"), icon: IconTodo },
  { id: "person", label: t("Persone e progetti"), icon: IconPeople },
  { id: "history", label: t("Tutte le call"), icon: IconCalls },
];

const MIN_W = 220;
const MAX_W = 360;
const DEFAULT_W = 248;

/** Open/closed and width, kept across restarts. */
export function useSidebarPrefs() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("mori.sidebar") !== "closed"; } catch { return true; }
  });
  const [width, setWidth] = useState(() => {
    try {
      const n = parseInt(localStorage.getItem("mori.sidebarW") ?? "", 10);
      return Number.isFinite(n) ? Math.min(MAX_W, Math.max(MIN_W, n)) : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("mori.sidebar", open ? "open" : "closed"); } catch { /* ignore */ }
  }, [open]);
  useEffect(() => {
    try { localStorage.setItem("mori.sidebarW", String(width)); } catch { /* ignore */ }
  }, [width]);
  return { open, setOpen, width, setWidth };
}

type Common = {
  view: View;
  mineCount: number;
  rec: RecState;
  recSecs: number;
  hotkey: string;
  onToggleRecord: () => void;
  onSection: (s: Section) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
};

export function Sidebar({
  width,
  setWidth,
  onCollapse,
  view,
  selected,
  sessions,
  jobs,
  mineCount,
  rec,
  recSecs,
  recError,
  silenceLeft,
  onKeepRecording,
  onStopNow,
  hotkey,
  onToggleRecord,
  onSection,
  onOpenSettings,
  onOpenPalette,
  onOpenShortcuts,
  onOpenSession,
  levels = null,
  issue = null,
}: Common & {
  width: number;
  setWidth: (w: number) => void;
  onCollapse: () => void;
  selected: string | null;
  sessions: Session[];
  jobs: Record<string, SessionJob>;
  recError: string | null;
  silenceLeft: number | null;
  onKeepRecording: () => void;
  onStopNow: () => void;
  onOpenSession: (id: string) => void;
  levels?: Levels | null;
  issue?: ChannelIssue;
}) {
  const recent = sessions.slice(0, 5);
  const progress = useTranscribeProgress();
  const understanding = useUnderstanding();
  const queuedOf = (kind: string) =>
    Object.values(jobs).filter((j) => j.kind === kind && (j.status === "pending" || j.status === "running")).length;
  // Transcribing first (it is the longer wait), then understanding.
  const work = progress
    ? { id: progress.sessionId, verb: t("Trascrivo"), fraction: progress.fraction, line: progressLine(progress), queued: queuedOf("transcribe") - 1 }
    : understanding
      ? {
          id: understanding.sessionId,
          verb: t("Capisco"),
          fraction: understandFraction(understanding),
          line: understandLine(understanding, Date.now()),
          queued: queuedOf("organize") - 1,
        }
      : null;
  const workSession = work ? sessions.find((x) => x.id === work.id) : undefined;

  // Drag the right edge to resize, clamped so it can't swallow the page or
  // shrink below what the labels need.
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, ev.clientX)));
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <aside className="sidebar" style={{ width }} aria-label={t("Barra laterale")}>
      <div className="sb-head">
        <button className="sb-brand" onClick={() => onSection("home")} title={t("Oggi")}>
          <Wordmark size={21} />
        </button>
        <button className="icon-btn" onClick={onOpenPalette} aria-label={t("Cerca o chiedi")} title={t("Cerca o chiedi (Ctrl K)")}>
          <IconSearch />
        </button>
        <button className="icon-btn" onClick={onCollapse} aria-label={t("Comprimi la barra laterale")} title={t("Comprimi la barra laterale (Ctrl \\)")}>
          <IconSidebar />
        </button>
      </div>

      <RecordControl
        state={rec}
        secs={recSecs}
        hotkey={hotkey}
        error={recError}
        silenceLeft={silenceLeft}
        onToggle={onToggleRecord}
        onKeep={onKeepRecording}
        onStopNow={onStopNow}
        levels={levels}
        issue={issue}
      />

      {work && workSession && (
        <WorkStrip
          verb={work.verb}
          title={workSession.title}
          fraction={work.fraction}
          line={work.line}
          queued={Math.max(0, work.queued)}
          onOpen={() => onOpenSession(workSession.id)}
        />
      )}

      <nav className="sb-nav" aria-label={t("Sezioni")}>
        {SECTIONS.map((s, i) => {
          const current = view === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              className="nav-item"
              data-nav={s.id}
              aria-current={current ? "page" : undefined}
              onClick={() => onSection(s.id)}
              title={`${s.label} (Ctrl ${i + 1})`}
            >
              <Icon />
              <span className="nav-label">{s.label}</span>
              {s.id === "todos" && mineCount > 0 && (
                <span className="nav-count" aria-label={t("{n} tue aperte", { n: mineCount })}>
                  {mineCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {recent.length > 0 && (
        <section className="sb-recent" aria-labelledby="sb-recent-h">
          <h2 id="sb-recent-h" className="sb-label">{t("Recenti")}</h2>
          {recent.map((s) => {
            const failed = s.status === "failed" || jobs[s.id]?.status === "failed";
            const current = view === "session" && selected === s.id;
            return (
              <button
                key={s.id}
                className="recent-item"
                aria-current={current ? "page" : undefined}
                onClick={() => onOpenSession(s.id)}
                title={`${s.title} · ${fmtDate(s.started_at)}`}
              >
                <span className="recent-title">{s.title}</span>
                {s.status === "transcribing" ? (
                  <span className="recent-state" title={t("La sto trascrivendo")}>
                    <span className="spinner sm" aria-hidden="true" />
                    <span className="sr-only">{t("in trascrizione")}</span>
                  </span>
                ) : failed ? (
                  <span className="recent-state ko" title={t("Non è riuscita: aprila e premi Riprova")}>
                    <IconAlert size={13} />
                    <span className="sr-only">{t("da riprovare")}</span>
                  </span>
                ) : s.sensitive === 1 ? (
                  <span className="recent-state priv" title={t("Privata: la legge solo un modello sul tuo PC")}>
                    <LockIcon size={12} />
                    <span className="sr-only">{t("privata")}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </section>
      )}

      <div className="sb-foot">
        <button
          className="nav-item"
          data-nav="settings"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={onOpenSettings}
          title={t("Impostazioni (Ctrl ,)")}
        >
          <IconSettings />
          <span className="nav-label">{t("Impostazioni")}</span>
        </button>
        <button className="icon-btn" onClick={onOpenShortcuts} aria-label={t("Scorciatoie da tastiera")} title={t("Scorciatoie da tastiera (?)")}>
          <IconKeyboard />
        </button>
      </div>

      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Ridimensiona la barra laterale")}
        onMouseDown={startResize}
        title={t("Trascina per ridimensionare")}
      />
    </aside>
  );
}

export function MiniRail({
  onExpand,
  view,
  mineCount,
  rec,
  recSecs,
  hotkey,
  onToggleRecord,
  onSection,
  onOpenSettings,
  onOpenPalette,
  onOpenShortcuts,
}: Common & { onExpand: () => void }) {
  const live = rec === "recording";
  return (
    <nav className="mini-rail" aria-label={t("Barra laterale compressa")}>
      <button className="mini-btn" onClick={onExpand} aria-label={t("Apri la barra laterale")} title={t("Apri la barra laterale (Ctrl \\)")}>
        <IconSidebar size={18} />
      </button>
      <button className="mini-btn" onClick={onOpenPalette} aria-label={t("Cerca o chiedi")} title={t("Cerca o chiedi (Ctrl K)")}>
        <IconSearch size={18} />
      </button>
      <button
        className={"mini-btn mini-rec " + rec}
        data-rec={rec}
        onClick={onToggleRecord}
        disabled={rec === "starting" || rec === "saving"}
        aria-label={live ? t("Ferma la registrazione ({time})", { time: fmtClock(recSecs) }) : t("Registra la call")}
        title={live ? t("Ferma e trascrivi") : t("Registra la call ({keys})", { keys: hotkeyParts(hotkey).join(" ") })}
      >
        <span className="mini-rec-dot" aria-hidden="true" />
      </button>
      {live && <span className="mini-rec-time mono" aria-hidden="true">{fmtClock(recSecs)}</span>}
      <div className="mini-sep" />
      {SECTIONS.map((s, i) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            className="mini-btn"
            data-nav={s.id}
            aria-current={view === s.id ? "page" : undefined}
            onClick={() => onSection(s.id)}
            aria-label={s.label}
            title={`${s.label} (Ctrl ${i + 1})${s.id === "todos" && mineCount > 0 ? ` · ${t("{n} tue", { n: mineCount })}` : ""}`}
          >
            <Icon size={18} />
            {s.id === "todos" && mineCount > 0 && <span className="mini-badge" aria-hidden="true" />}
          </button>
        );
      })}
      <div className="mini-spacer" />
      <button className="mini-btn" data-nav="settings" aria-current={view === "settings" ? "page" : undefined} onClick={onOpenSettings} aria-label={t("Impostazioni")} title={t("Impostazioni (Ctrl ,)")}>
        <IconSettings size={18} />
      </button>
      <button className="mini-btn" onClick={onOpenShortcuts} aria-label={t("Scorciatoie da tastiera")} title={t("Scorciatoie da tastiera (?)")}>
        <IconKeyboard size={18} />
      </button>
    </nav>
  );
}
