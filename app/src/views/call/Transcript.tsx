// The transcript of a call: the click-to-play dialogue, the plain fallback, and
// "Chi è l'interlocutore?" above it.
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Segment } from "../../db";
import { speakerLabel, type SpeakerMap } from "../../speakers-logic";
import { t } from "../../i18n";
import type { Entity } from "../people";
import { fmtClock } from "../../ui/format";
import VoicesTimeline, { voiceShares } from "./VoicesTimeline";
import type { Detail } from "./types";

/** Names worth offering for "Interlocutore": this call's participants first,
 *  then the people Mori knows — never the user's own names. */
export function speakerSuggestions(detail: Detail, entities: Entity[], myNames: string[]): string[] {
  const mine = new Set(myNames.map((n) => n.trim().toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const k = n.trim().toLowerCase();
    if (!k || mine.has(k) || seen.has(k) || k === "interlocutore") return;
    seen.add(k);
    out.push(n.trim());
  };
  detail.participants.forEach((p) => add(p.display_name));
  entities.filter((e) => e.kind === "person").forEach((e) => add(e.name));
  return out.slice(0, 30);
}

// "Chi è l'interlocutore?" — one line above the transcript. The recorder only
// knows "Tu" and everyone else; the user knows who that was.
export function SpeakerNamer({
  labels,
  map,
  suggestions,
  hasSummary,
  onSave,
  onReorganize,
}: {
  labels: string[];
  map: SpeakerMap;
  suggestions: string[];
  hasSummary: boolean;
  onSave: (label: string, name: string) => void;
  onReorganize: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [justNamed, setJustNamed] = useState(false);
  return (
    <div className="speaker-namer">
      {labels.map((label) => {
        const named = map[label];
        if (named && editing !== label) {
          return (
            <div key={label} className="sn-row">
              <svg className="sn-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>
              <span>
                {t("“{label}” è", { label: speakerLabel(label) })} <strong>{named}</strong>
              </span>
              <button className="link-btn" onClick={() => { setEditing(label); setDraft(named); }}>
                {t("cambia")}
              </button>
              {justNamed && hasSummary && (
                <button className="link-btn" onClick={() => { setJustNamed(false); onReorganize(); }}>
                  {t("rifai la sintesi con il nome")}
                </button>
              )}
            </div>
          );
        }
        return (
          <form
            key={label}
            className="sn-row"
            onSubmit={(e) => {
              e.preventDefault();
              onSave(label, draft);
              setEditing(null);
              setJustNamed(!!draft.trim());
            }}
          >
            <svg className="sn-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>
            <span>{t("Chi è “{label}”?", { label: speakerLabel(label) })}</span>
            <input
              list={`sn-${label}`}
              value={draft}
              autoFocus={editing === label}
              placeholder={t("es. Giulia Ferri")}
              aria-label={t("Nome di “{label}”", { label: speakerLabel(label) })}
              onChange={(e) => setDraft(e.target.value)}
            />
            <datalist id={`sn-${label}`}>
              {suggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button className="btn sm" type="submit" disabled={!draft.trim() && !named}>
              {named && !draft.trim() ? t("Togli") : t("Salva")}
            </button>
            {editing === label && (
              <button className="link-btn" type="button" onClick={() => setEditing(null)}>
                {t("annulla")}
              </button>
            )}
          </form>
        );
      })}
    </div>
  );
}

type Turn = { speaker: string; text: string };

function parseTurns(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (m && /^(Tu|Interlocutore|[A-ZÀ-Ù])/.test(m[1].trim())) {
      turns.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text += " " + line;
    } else {
      turns.push({ speaker: "", text: line });
    }
  }
  // No real speaker labels → let the caller fall back to a plain paragraph.
  if (turns.every((t) => t.speaker === "")) return [];
  return turns;
}

export function TranscriptView({ text }: { text: string }) {
  const turns = parseTurns(text);
  if (turns.length === 0) return <p className="transcript">{text}</p>;
  return (
    <ol className="dialogue no-time">
      {turns.map((t, i) => (
        <li key={i} className={"turn " + (t.speaker === "Tu" ? "me" : "other")}>
          <div className="turn-btn static">
            <span className="turn-body">
              {t.speaker && (i === 0 || turns[i - 1].speaker !== t.speaker) && <span className="speaker">{speakerLabel(t.speaker)}</span>}
              <span className="turn-text">{t.text}</span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Trascritto with click-to-play: each timestamped line seeks the (single, compact)
// audio element and plays from there. Falls back to a read-only dialogue when the
// audio file is gone (moved/deleted, or a legacy recording with segments only).
export function SegmentPlayer({
  segments,
  audioPath,
  seekTo,
}: {
  segments: Segment[];
  audioPath: string | null;
  seekTo?: { start: number; n: number } | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const src = audioPath ? convertFileSrc(audioPath) : null;

  const seek = (start: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = start + 0.01; // nudge past the boundary so the right line lights up
    void a.play();
  };

  // Seek requested from a chat source chip ("▶ mm:ss"). Wait for metadata if the
  // audio hasn't loaded its duration yet. `seekTo.n` re-triggers repeat clicks.
  useEffect(() => {
    if (!seekTo || !src) return;
    const a = audioRef.current;
    if (!a) return;
    const go = () => seek(seekTo.start);
    if (a.readyState >= 1) go();
    else a.addEventListener("loadedmetadata", go, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo?.n, src]);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  // The segment currently under the playhead (for highlighting).
  const activeIdx = segments.findIndex((s) => cur >= s.start && cur < s.end);
  const total = segments.reduce((m, s) => Math.max(m, s.end), 0);
  const shares = voiceShares(segments);
  const listRef = useRef<HTMLOListElement>(null);

  // A click on the strip: with audio, play from there; without, scroll to that line.
  const goTo = (secs: number, index: number) => {
    if (src) seek(secs);
    else listRef.current?.children[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div className="seg-player">
      <div className="seg-controls">
        {src && (
          <button className="seg-play" onClick={toggle} aria-label={playing ? t("Pausa") : t("Riproduci")} title={playing ? t("Pausa") : t("Riproduci")}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
        )}
        {src && <span className="seg-clock mono">{fmtClock(Math.floor(cur))}</span>}
        <VoicesTimeline segments={segments} current={src ? cur : null} onSeek={goTo} />
        <span className="seg-total mono">{fmtClock(Math.floor(total))}</span>
      </div>
      <div className="seg-meta">
        {shares.map((v) => (
          <span key={v.name} className={"seg-share" + (v.me ? " me" : "")}>
            <b>{speakerLabel(v.name)}</b> <span className="mono">{Math.round(v.share * 100)}%</span>
          </span>
        ))}
        {src && <span className="seg-hint">{t("Clicca una riga, o premi Invio, per ascoltarla da lì")}</span>}
      </div>
      {src && (
        <>
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </>
      )}
      <ol className="dialogue" ref={listRef}>
        {segments.map((s, i) => {
          const body = (
            <>
              <span className="turn-time mono">{fmtClock(Math.floor(s.start))}</span>
              <span className="turn-body">
                {s.speaker && (i === 0 || segments[i - 1].speaker !== s.speaker) && <span className="speaker">{speakerLabel(s.speaker)}</span>}
                <span className="turn-text">{s.text}</span>
              </span>
            </>
          );
          return (
            <li
              key={i}
              className={"turn " + (s.speaker === "Tu" ? "me" : "other") + (i === activeIdx ? " active" : "")}
              aria-current={i === activeIdx ? "true" : undefined}
            >
              {src ? (
                <button className="turn-btn" onClick={() => seek(s.start)} title={t("Ascolta da qui")}>
                  {body}
                </button>
              ) : (
                <div className="turn-btn static">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
