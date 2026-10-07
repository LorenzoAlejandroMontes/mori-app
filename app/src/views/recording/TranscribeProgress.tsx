// The live line of a transcription: how far Whisper is, and how long it still
// needs. The same line in the sidebar (under the recorder), on the page of the
// call and — drawn by the pill itself — in the always-on-top status pill.
import { t } from "../../i18n";

/** A thin line; indeterminate (a moving sweep) while there is no number yet. */
export function ProgressLine({ fraction, className = "" }: { fraction: number | null; className?: string }) {
  const known = fraction !== null;
  return (
    <span
      className={"tp-line " + (known ? "" : "indet ") + className}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(fraction * 100) : undefined}
      aria-label={t("Avanzamento della trascrizione")}
    >
      <span style={known ? { transform: `scaleX(${fraction})` } : undefined} />
    </span>
  );
}

/** Under the recorder in the sidebar: what Mori is doing to which call, how
 *  far, and what is left — transcribing, then understanding. A click opens it. */
export function WorkStrip({
  verb,
  title,
  fraction,
  line,
  queued,
  onOpen,
}: {
  /** "Trascrivo", "Capisco". */
  verb: string;
  title: string;
  fraction: number | null;
  line: string;
  /** Calls waiting behind this one. */
  queued: number;
  onOpen: () => void;
}) {
  return (
    <button className="tr-strip" onClick={onOpen} title={t("Apri la call")}>
      <span className="tr-strip-top">
        <span className="spinner sm" aria-hidden="true" />
        <span className="tr-strip-title">
          <b>{verb}</b> {title}
        </span>
      </span>
      <ProgressLine fraction={fraction} />
      <span className="tr-strip-meta">
        <span className="tr-strip-line">{line}</span>
        {queued > 0 && <span className="tr-strip-q">{t("+{n} in coda", { n: queued })}</span>}
      </span>
    </button>
  );
}
