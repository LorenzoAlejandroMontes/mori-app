// The call as a strip of time: two lanes, you (teal) above and the other
// voice (violet) below, each block a stretch of speech. One glance says who
// held the floor and when; a click goes to that moment. Built from the
// segments already on disk — no model, no network.
import { useMemo } from "react";
import type { Segment } from "../../db";
import { fmtClock } from "../../ui/format";
import { t } from "../../i18n";

export type VoiceShare = { name: string; me: boolean; secs: number; share: number };

/** How much each voice spoke, in seconds and as a share of all speech. */
export function voiceShares(segments: Segment[]): VoiceShare[] {
  const by = new Map<string, number>();
  for (const s of segments) {
    const d = Math.max(0, s.end - s.start);
    by.set(s.speaker, (by.get(s.speaker) ?? 0) + d);
  }
  const total = Array.from(by.values()).reduce((a, b) => a + b, 0) || 1;
  return Array.from(by.entries())
    .map(([name, secs]) => ({ name, me: name === "Tu", secs, share: secs / total }))
    .sort((a, b) => Number(b.me) - Number(a.me) || b.secs - a.secs);
}

export default function VoicesTimeline({
  segments,
  current,
  onSeek,
}: {
  segments: Segment[];
  /** The playhead, in seconds; null when there is no audio. */
  current: number | null;
  onSeek: (secs: number, index: number) => void;
}) {
  const total = useMemo(() => segments.reduce((m, s) => Math.max(m, s.end), 0), [segments]);
  if (!segments.length || total <= 0) return null;
  const pct = (t: number) => `${(Math.max(0, Math.min(total, t)) / total) * 100}%`;

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * total;
    // The segment under the click, else the nearest one before it.
    let i = segments.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0) i = Math.max(0, segments.findIndex((s) => s.start > t) - 1);
    onSeek(t, i);
  }

  return (
    <div
      className="voices-tl"
      role="img"
      aria-label={t("Chi parla quando, su {total}. Clicca per ascoltare da quel punto.", { total: fmtClock(Math.floor(total)) })}
      title={t("Chi parla quando · clicca per andare a quel momento")}
      onClick={onClick}
    >
      {segments.map((s, i) => (
        <span
          key={i}
          className={"vtl-block " + (s.speaker === "Tu" ? "me" : "other")}
          style={{ left: pct(s.start), width: `max(2px, calc(${pct(s.end)} - ${pct(s.start)}))` }}
          aria-hidden="true"
        />
      ))}
      {current !== null && <span className="vtl-head" style={{ left: pct(current) }} aria-hidden="true" />}
    </div>
  );
}
