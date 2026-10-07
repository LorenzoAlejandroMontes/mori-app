// "Sembra una call: la registro?" — offered when a call app is in front.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCallDetect } from "../recorder";
import type { Entity } from "./people";
import { t, tn } from "../i18n";

export default function CallDetectBanner({
  busy,
  recording,
  entities,
  onRecord,
  onOpenPerson,
}: {
  /** Recording or saving: nothing to suggest. */
  busy: boolean;
  recording: boolean;
  entities: Entity[];
  onRecord: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [callBanner, setCallBanner] = useState<string | null>(null);
  const [briefPickFor, setBriefPickFor] = useState(false);
  const dismissedCalls = useRef<Record<string, number>>({});

  // Gently suggest recording when a call app is in the foreground. Polls the
  // window title every 5s while idle; each title is re-suggested at most once
  // per 10 min after a dismissal. Never auto-records — just offers.
  useEffect(() => {
    if (busy) {
      setCallBanner(null);
      return;
    }
    let alive = true;
    const CALL_RE = /(google meet|meet\.google|zoom|microsoft teams|webex)/i;
    const check = async () => {
      if (!getCallDetect()) {
        if (alive) setCallBanner(null);
        return;
      }
      try {
        const title = await invoke<string>("foreground_window_title");
        if (!alive) return;
        if (!title || !CALL_RE.test(title)) {
          setCallBanner(null);
          return;
        }
        const last = dismissedCalls.current[title] ?? 0;
        setCallBanner(Date.now() - last < 10 * 60 * 1000 ? null : title);
      } catch {
        /* window probing is best-effort */
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);

  if (!callBanner || recording) return null;

  return (
    <>
      <div className="toast call-detect" role="dialog" aria-label={t("Suggerimento registrazione")}>
        <span className="cd-dot" aria-hidden="true" />
        <span className="toast-msg">{t("Sembra una call: la registro?")}</span>
        <button className="btn sm primary" onClick={() => { setCallBanner(null); onRecord(); }}>{t("Registra")}</button>
        {/* Sessione 3 · prima di entrare, cosa vi eravate detti */}
        <button className="btn sm" aria-expanded={briefPickFor} onClick={() => setBriefPickFor((v) => !v)}>{t("Prepara il brief")}</button>
        <button className="btn sm ghost" onClick={() => { dismissedCalls.current[callBanner] = Date.now(); setCallBanner(null); setBriefPickFor(false); }}>{t("No")}</button>
      </div>
      {/* Outside the toast stack: it is transformed, and a fixed veil inside
          it would cover the stack instead of the window. */}
      {briefPickFor && createPortal(
        <>
          <div className="merge-backdrop" onClick={() => setBriefPickFor(false)} />
          <div className="brief-pick">
            <div className="brief-pick-head">{t("Con chi è la call?")}</div>
            <div className="merge-list">
              {entities.length === 0 && (
                <div className="person-empty" style={{ padding: "10px 12px" }}>
                  {t("Ancora nessuna scheda: nascono quando Mori capisce una call.")}
                </div>
              )}
              {entities
                .slice()
                .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
                .slice(0, 8)
                .map((e) => (
                  <button
                    key={e.id}
                    className="merge-row"
                    onClick={() => {
                      setBriefPickFor(false);
                      setCallBanner(null);
                      onOpenPerson(e.id);
                    }}
                  >
                    <span className={"merge-mini" + (e.kind === "project" ? " proj" : "")}>
                      {(e.name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    {e.name}
                    <span className="merge-cnt">{tn(e.calls, "1 call", "{n} call")}</span>
                  </button>
                ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
