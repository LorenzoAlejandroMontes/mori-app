// "«Sync prodotto» è pronta · 3 cose da fare · Apri": the moment a call has
// been understood, wherever you are in Mori — so nobody keeps checking. With
// Mori behind other windows the same news goes to the pill (App.tsx).
import { useEffect } from "react";
import { t, tn } from "../i18n";
import { IconClose } from "../ui/icons";

export type Ready = { id: string; title: string; todos: number };

export default function ReadyToast({ ready, onOpen, onClose }: { ready: Ready | null; onOpen: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(onClose, 9000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready?.id]);
  if (!ready) return null;
  return (
    <div key={ready.id} className="toast ready" role="status">
      <span className="ready-dot" aria-hidden="true" />
      <span className="toast-msg">
        <b>{t("«{title}» è pronta", { title: ready.title })}</b>
        {ready.todos > 0 && <span className="ready-sub"> · {tn(ready.todos, "1 cosa da fare", "{n} cose da fare")}</span>}
      </span>
      <button
        className="btn sm primary"
        onClick={() => {
          onOpen(ready.id);
          onClose();
        }}
      >
        {t("Apri")}
      </button>
      <button className="toast-x" aria-label={t("Chiudi")} onClick={onClose}>
        <IconClose size={14} />
      </button>
    </div>
  );
}
