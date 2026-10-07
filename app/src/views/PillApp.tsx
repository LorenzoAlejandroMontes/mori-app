// La pillola: una finestrella senza cornice, sempre sopra le altre, che conferma
// cosa è appena successo senza far aprire Mori. Gira nello stesso bundle del
// frontend, su `index.html#pill`, e non tocca il database: sa solo quello che
// il backend le manda con l'evento `companion://pill`.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ProgressLine } from "./recording/TranscribeProgress";
import { t } from "../i18n";

type Pill = {
  kind: "started" | "stopped" | "info" | "silence" | "status";
  title: string;
  subtitle?: string;
  hint?: string;
  seconds?: number;
  phase?: "recording" | "saving" | "transcribing" | "understanding" | "";
  since?: number;
  /** 0…1 while transcribing, -1 when not known yet. */
  progress?: number;
};

function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export default function PillApp() {
  const [pill, setPill] = useState<Pill | null>(null);
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(60);
  const [now, setNow] = useState(Date.now());

  // La lingua si cambia nella finestra principale: questa la segue ricaricandosi
  // (i testi calcolati all'avvio ripartono così nella lingua nuova).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "mori.lang") window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const un = listen<Pill>("companion://pill", (e) => {
      setPill(e.payload);
      if (e.payload.kind === "silence") {
        const s = e.payload.seconds && e.payload.seconds > 0 ? e.payload.seconds : 60;
        setLeft(s);
        setTotal(s);
      }
    });
    // La prima pillola di una sessione arriva mentre questa finestra sta ancora
    // nascendo e il listener qui sopra non esiste: si perderebbe e resterebbe
    // una pillola bianca. Appena registrato, si dice al backend "ci sono" e lui
    // rimanda l'ultima.
    void un.then(() => invoke("companion_pill_ready").catch(() => {}));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Il conto alla rovescia lo tiene la finestra principale (è lei che ferma
  // davvero): qui si mostra e basta, ripartendo da ogni evento.
  useEffect(() => {
    if (pill?.kind !== "silence") return;
    const timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [pill?.kind, total]);

  // Il timer della registrazione si calcola dall'inizio, non si conta: se la
  // finestrella resta nascosta un po', al ritorno segna comunque il tempo vero.
  const ticking = pill?.kind === "status" && pill.phase === "recording";
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

  function act(action: "keep" | "stop" | "toggle" | "open") {
    void invoke("companion_pill_action", { action });
  }

  if (!pill) return <div className="pill-root" />;

  if (pill.kind === "silence") {
    return (
      <div className="pill-root">
        <div className="pill-count" role="alert">
          <div className="pill-count-top">
            <div className="pill-count-txt">
              <div className="pill-count-h">{pill.title}</div>
              {pill.subtitle && <div className="pill-count-s">{pill.subtitle}</div>}
            </div>
            <div className="pill-count-n" aria-hidden="true">{left}s</div>
          </div>
          <div className="pill-bar" aria-hidden="true">
            <span style={{ width: `${total ? (left / total) * 100 : 0}%` }} />
          </div>
          <div className="pill-count-acts">
            <button className="btn primary pill-keep" onClick={() => act("keep")}>
              {t("Continua a registrare")}
            </button>
            <button className="btn pill-stop" onClick={() => act("stop")}>
              {t("Ferma adesso")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pill.kind === "status") {
    const rec = pill.phase === "recording";
    return (
      <div className="pill-root status-root">
        <div className={"status-pill " + (pill.phase || "")} role="status" data-tauri-drag-region>
          {rec ? (
            <span className="status-dot" data-tauri-drag-region />
          ) : (
            <span className="status-spin" data-tauri-drag-region />
          )}
          <span className="status-txt" data-tauri-drag-region>
            {rec && pill.hint ? (
              <span className="status-lab status-warn" data-tauri-drag-region role="alert">
                {pill.hint}
              </span>
            ) : (
              <span className="status-lab" data-tauri-drag-region>{pill.title}</span>
            )}
            {rec && (
              <span className="status-time" data-tauri-drag-region>
                {clock((now - (pill.since || now)) / 1000)}
              </span>
            )}
            {!rec && pill.subtitle && <span className="status-sub" data-tauri-drag-region>{pill.subtitle}</span>}
          </span>
          {rec && (
            <button className="status-stop" onClick={() => act("toggle")} title={t("Ferma e trascrivi")} aria-label={t("Ferma e trascrivi")}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
              {t("Ferma")}
            </button>
          )}
          {(pill.phase === "transcribing" || pill.phase === "understanding") && (
            <span className="status-progress" aria-hidden="true">
              <ProgressLine fraction={pill.progress !== undefined && pill.progress >= 0 ? pill.progress : null} />
            </span>
          )}
          <button className="status-open" onClick={() => act("open")} title={t("Apri Mori")} aria-label={t("Apri Mori")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pill-root">
      <div className="pill" role="status">
        <span className={"dot" + (pill.kind === "started" ? "" : " calm")} aria-hidden="true" />
        <span className="lab">{pill.title}</span>
        {pill.subtitle && <span className="sub">· {pill.subtitle}</span>}
        {pill.hint && <span className="kbd">{pill.hint}</span>}
      </div>
    </div>
  );
}
