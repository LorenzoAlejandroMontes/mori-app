// "Incolla un trascritto": a call you already have in writing. Mori finds the
// participants and then understands it on its own.
import { useState } from "react";
import Dialog from "../ui/Dialog";
import { t, tx } from "../i18n";

export default function AddCallModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (c: { title: string; transcript: string; sensitive: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!transcript.trim()) {
      setErr(t("Incolla il trascritto della call."));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onAdd({ title, transcript, sensitive });
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("Incolla un trascritto")} onClose={onClose} wide>
      <p className="dialog-hint">
        {t("Mori riconosce i partecipanti e poi la capisce da solo: sintesi, decisioni, cose da fare, memoria.")}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="add-title">{t("Titolo")}</label>
          <input id="add-title" className="input" value={title} placeholder={t("es. Allineamento autofatture")} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="add-text">{t("Trascritto")}</label>
          <textarea
            id="add-text"
            className="input"
            rows={11}
            placeholder={t("Incolla qui il testo della conversazione…\nes. Tu: partiamo dall'onboarding\nGiulia: il design è chiuso")}
            value={transcript}
            aria-invalid={!!err && !transcript.trim()}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
        <label className="switch-row" htmlFor="add-private">
          <span className="switch-text">
            <span className="field-label">{t("Privata")}</span>
            <span className="field-hint">{t("La legge solo un modello sul tuo PC, mai il cloud.")}</span>
          </span>
          <input id="add-private" type="checkbox" role="switch" className="switch" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
        </label>
        {err && (
          <p className="field-error" role="alert">
            {err}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {tx("Annulla", "Cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t("Aggiungo…") : t("Aggiungi e organizza")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
