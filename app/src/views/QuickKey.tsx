// The first step of a new Mori, done where it is asked: paste a Groq key, it
// is checked with one tiny request and saved. One key is the whole setup —
// the model that understands the calls and the fast cloud transcription both
// use it. Anything else (a local model, another provider) stays in Settings.
import { useState } from "react";
import { t } from "../i18n";
import { testProvider, type ProviderConfig } from "../llm";
import { GROQ_URL } from "../recorder";

export const GROQ_MODEL = "openai/gpt-oss-120b";

export default function QuickKey({ onSaved, onMore }: { onSaved: (cfg: ProviderConfig) => void; onMore: () => void }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function connect() {
    const apiKey = key.trim();
    if (!apiKey) return;
    setState({ busy: true, error: null });
    const cfg: ProviderConfig = { baseUrl: GROQ_URL, apiKey, model: GROQ_MODEL };
    const r = await testProvider(cfg);
    if (r.ok) {
      setState({ busy: false, error: null });
      onSaved(cfg);
    } else {
      setState({ busy: false, error: r.message });
    }
  }

  return (
    <form
      className="quick-key"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <div className="quick-key-row">
        <input
          className="input mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="gsk_…"
          aria-label={t("Chiave Groq")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={state.busy}
        />
        <button className="btn sm primary" type="submit" disabled={!key.trim() || state.busy}>
          {state.busy ? t("Verifico…") : t("Collega")}
        </button>
      </div>
      {state.error ? (
        <p className="quick-key-msg ko" role="alert">
          {state.error}
        </p>
      ) : (
        <p className="quick-key-msg">
          {t("Gratis su console.groq.com → API Keys. Resta sul tuo PC.")}{" "}
          <button type="button" className="link-btn" onClick={onMore}>
            {t("Altri modelli")}
          </button>
        </p>
      )}
    </form>
  );
}
