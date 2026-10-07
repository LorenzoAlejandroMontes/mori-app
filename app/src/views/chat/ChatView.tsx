// "Chiedi a Mori" — the conversation as a page: one readable column, the field
// at the bottom. "Nuova chat" starts over at once and offers Annulla.
import Dragon from "../../ui/Mark";
import { IconPlus } from "../../ui/icons";
import type { OfferUndo } from "../../ui/useUndo";
import type { OpenSource } from "./AnswerBody";
import ChatThread from "./ChatThread";
import type { Chat } from "./useChat";
import { t } from "../../i18n";

const STARTERS = [
  t("Cosa devo ancora fare questa settimana?"),
  t("Cosa abbiamo deciso nell'ultima call?"),
  t("Chi mi deve ancora qualcosa?"),
];

export default function ChatView({
  chat,
  onOpenSource,
  offerUndo,
}: {
  chat: Chat;
  onOpenSource: OpenSource;
  offerUndo: OfferUndo;
}) {
  return (
    <div className="chat-page">
      <header className="page-bar">
        <h1 className="page-bar-title">
          <Dragon size={18} />
          {t("Chiedi a Mori")}
        </h1>
        <button
          className="btn sm"
          disabled={chat.turns.length === 0 || chat.asking}
          onClick={() => {
            const restore = chat.newChat();
            offerUndo(t("Nuova chat. La conversazione di prima resta salvata."), () => {}, restore);
          }}
          title={t("Ricomincia da una conversazione vuota")}
        >
          <IconPlus size={14} />
          {t("Nuova chat")}
        </button>
      </header>
      <ChatThread
        chat={chat}
        onOpenSource={onOpenSource}
        autoFocus
        empty={
          <div className="chat-hello">
            <Dragon size={44} />
            <h2>{t("Chiedimi delle tue call")}</h2>
            <p>
              {t("Rispondo solo da quello che hai registrato, e cito sempre la call da cui prendo: clicca la citazione e la apri al minuto giusto.")}
            </p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => void chat.ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
