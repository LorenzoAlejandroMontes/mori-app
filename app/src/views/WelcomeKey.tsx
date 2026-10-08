// The first thing a new Mori asks, before anything else: a Groq key. Two steps
// in one place (make the key, paste it), because without one every call is
// transcribed on this computer and takes much longer. It can be skipped: the
// same field stays on Today until a model is connected.
import { invoke } from "@tauri-apps/api/core";
import Dialog from "../ui/Dialog";
import Dragon from "../ui/Mark";
import QuickKey from "./QuickKey";
import { t } from "../i18n";
import type { ProviderConfig } from "../llm";

export default function WelcomeKey({
  onSaved,
  onSkip,
  onMore,
}: {
  onSaved: (cfg: ProviderConfig) => void;
  onSkip: () => void;
  onMore: () => void;
}) {
  return (
    <Dialog onClose={onSkip} className="welcome-key" labelledBy="welcome-key-title">
      <Dragon size={28} />
      <h2 id="welcome-key-title" className="dialog-title">
        {t("Una chiave, e le tue call sono pronte in pochi secondi.")}
      </h2>
      <p className="dialog-hint">
        {t("Mori usa Groq per trascrivere le call e capirle. Le chiavi Groq sono gratuite e si creano in un minuto.")}
      </p>
      <ol className="wk-steps">
        <li>
          <span className="ws-n">1</span>
          <div>
            <strong>{t("Crea una chiave")}</strong>
            <button type="button" className="btn sm" onClick={() => void invoke("open_groq_keys").catch(() => {})}>
              {t("Apri console.groq.com/keys")}
            </button>
          </div>
        </li>
        <li>
          <span className="ws-n">2</span>
          <div>
            <strong>{t("Incollala qui")}</strong>
            <QuickKey onSaved={onSaved} onMore={onMore} bare />
          </div>
        </li>
      </ol>
      <div className="wk-foot">
        <span>{t("Senza chiave Mori trascrive su questo computer e ci mette molto di più.")}</span>
        <button type="button" className="link-btn" onClick={onSkip}>
          {t("Salta per ora")}
        </button>
      </div>
    </Dialog>
  );
}
