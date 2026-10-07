// One chat turn's body. The user's words stay as typed; Mori's answer is read
// as Markdown, and its [Titolo — data] citations open the call at the right
// moment — the sources row underneath stays for the ones not cited inline.
import type { Source } from "../../recall";
import Markdown from "../../ui/Markdown";
import { fmtClock } from "../../ui/format";
import { t } from "../../i18n";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
  /** The answer still being written (streaming). */
  streaming?: boolean;
  /** Calls the answer drew on (see recall.ts → usedSessions). */
  used?: string[];
};

export type OpenSource = (id: string, start?: number | null) => void;

export function AnswerBody({ turn, onOpen }: { turn: ChatTurn; onOpen: OpenSource }) {
  if (turn.role === "user" || turn.error) return <div className="bubble-text">{turn.content}</div>;
  if (turn.streaming && !turn.content) {
    return (
      <div className="thinking">
        <span></span><span></span><span></span>
      </div>
    );
  }
  const sources = turn.sources ?? [];
  return (
    <>
      <Markdown
        text={turn.content}
        sources={sources}
        onCite={(s) => onOpen(s.id, s.start)}
        compact
        className={turn.streaming ? "md-streaming" : ""}
      />
      {/* The sources row comes once the answer is complete: no jumping chips mid-sentence. */}
      {!turn.streaming && sources.length > 0 && <SourcesRow sources={sources} onOpen={onOpen} />}
    </>
  );
}

// Sources under a chat answer: the call title+date, plus a "▶ mm:ss" chip when
// the best-matching chunk has a timestamp — it opens the call and seeks the audio.
function SourcesRow({ sources, onOpen }: { sources: Source[]; onOpen: OpenSource }) {
  return (
    <div className="sources">
      {sources.map((s) => (
        <span key={s.id} className="source-item">
          <button className="source-chip" onClick={() => onOpen(s.id)}>
            {s.title} · {s.date}
          </button>
          {s.start != null && (
            <button className="source-seek" title={t("Ascolta da qui")} onClick={() => onOpen(s.id, s.start)}>
              ▶ {fmtClock(Math.floor(s.start))}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
