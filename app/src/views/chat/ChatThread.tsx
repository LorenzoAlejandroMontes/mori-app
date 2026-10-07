// The conversation and its composer, shared by the chat page and the panel on
// a call: the same turns, the same thread, two sizes.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Dragon from "../../ui/Mark";
import { IconSend } from "../../ui/icons";
import { AnswerBody, type OpenSource } from "./AnswerBody";
import type { Chat } from "./useChat";
import { t } from "../../i18n";
import "./Chat.css";

export default function ChatThread({
  chat,
  onOpenSource,
  empty,
  compact,
  autoFocus,
  placeholder = t("Chiedi a Mori…"),
}: {
  chat: Chat;
  onOpenSource: OpenSource;
  /** What an empty conversation shows. */
  empty: ReactNode;
  compact?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { turns, asking, draft, setDraft, ask } = chat;
  const scrollRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);

  // Open at the latest answer, then follow it smoothly as it is written.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: mounted.current ? "smooth" : "auto" });
    mounted.current = true;
  }, [turns, asking]);

  useEffect(() => {
    if (autoFocus) boxRef.current?.focus();
  }, [autoFocus]);

  // The field grows with what is written, up to six lines.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 6 * 22 + 20) + "px";
  }, [draft]);

  const dragon = compact ? 16 : 18;
  return (
    <div className={"thread" + (compact ? " compact" : "")}>
      <div className="thread-scroll" ref={scrollRef}>
        <div className="thread-col">
          {turns.length === 0 && empty}
          {turns.map((t, i) => (
            <div key={i} className={"bubble " + t.role + (t.error ? " error" : "")}>
              {t.role === "assistant" && (
                <span className="bubble-dragon" aria-hidden="true">
                  <Dragon size={dragon} />
                </span>
              )}
              <div className="bubble-body">
                {t.role === "assistant" && <span className="sr-only">Mori: </span>}
                <AnswerBody turn={t} onOpen={onOpenSource} />
              </div>
            </div>
          ))}
          {asking && !turns[turns.length - 1]?.streaming && (
            <div className="bubble assistant">
              <span className="bubble-dragon" aria-hidden="true">
                <Dragon size={dragon} />
              </span>
              <div className="bubble-body">
                <div className="thinking" role="status" aria-label={t("Mori sta pensando")}>
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="composer-box">
          <textarea
            ref={boxRef}
            rows={1}
            value={draft}
            placeholder={placeholder}
            aria-label={t("Domanda per Mori")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask();
              }
            }}
          />
          <button type="submit" className="composer-send" disabled={asking || !draft.trim()} aria-label={t("Invia")} title={t("Invia (Invio)")}>
            <IconSend size={15} />
          </button>
        </div>
        {!compact && <p className="composer-hint">{t("Invio per mandare · Maiusc+Invio per andare a capo")}</p>}
      </form>
    </div>
  );
}
