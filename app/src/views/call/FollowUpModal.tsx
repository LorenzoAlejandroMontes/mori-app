// The follow-up email, drafted by the model the call may reach (a private call
// only by a local one), editable before copying. Nothing is ever sent by Mori.
import { useEffect, useState } from "react";
import { draftFollowUp } from "../../followup";
import { copyText } from "../../ui/format";
import Dialog from "../../ui/Dialog";
import { t } from "../../i18n";

export default function FollowUpModal({
  sessionId,
  myName,
  onClose,
  onCopied,
  onOpenSettings,
}: {
  sessionId: string;
  myName: string | null;
  onClose: () => void;
  onCopied: () => void;
  onOpenSettings: () => void;
}) {
  const [state, setState] = useState<"loading" | "ok" | "nokey" | "error">("loading");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setMsg(null);
    void draftFollowUp(sessionId, myName).then((r) => {
      if (!alive) return;
      if (r.state === "ok") {
        setText(r.text);
        setState("ok");
      } else if (r.state === "nokey") {
        setIsPrivate(r.private);
        setState("nokey");
      } else {
        setMsg(r.message);
        setState("error");
      }
    });
    return () => {
      alive = false;
    };
  }, [sessionId, myName, round]);

  async function copy() {
    try {
      await copyText(text);
      onCopied();
      onClose();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <Dialog title={t("Mail di follow-up")} onClose={onClose} wide>
      <p className="dialog-hint">
        {t("Scritta dai fatti già estratti (sintesi, decisioni, prossimi passi), non dal trascritto. Rileggila e correggila: Mori non invia niente, la copi tu.")}
      </p>
      {state === "loading" && (
        <div className="fu-loading" role="status" aria-label={t("Sto scrivendo la mail")}>
          <div className="skeleton-lines">
            {[40, 92, 86, 74, 88, 30].map((w, i) => (
              <span key={i} className="skeleton" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      )}
      {state === "ok" && (
        <textarea
          className="input fu-text"
          rows={15}
          aria-label={t("Testo della mail")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {state === "nokey" && (
        <p className="field-error" role="alert">
          {isPrivate
            ? t("È una call privata: la scrivo solo con un modello locale (Ollama o LM Studio). Impostalo in Impostazioni → Modello.")
            : t("Mi serve un modello: impostalo in Impostazioni → Modello.")}
        </p>
      )}
      {(state === "error" || msg) && (
        <p className="field-error" role="alert">
          {msg}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={onClose}>
          {t("Chiudi")}
        </button>
        {state === "nokey" && (
          <button className="btn primary" onClick={onOpenSettings}>
            {t("Apri le impostazioni")}
          </button>
        )}
        {(state === "ok" || state === "error") && (
          <button className="btn" onClick={() => setRound((n) => n + 1)}>
            {t("Riscrivi")}
          </button>
        )}
        {state === "ok" && (
          <button className="btn primary" onClick={() => void copy()} disabled={!text.trim()}>
            {t("Copia la mail")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
