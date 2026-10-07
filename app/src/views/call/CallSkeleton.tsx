// The shape of a call page while it loads: no spinner on an empty page.
import { t } from "../../i18n";

export default function CallSkeleton() {
  return (
    <div className="call-page" aria-busy="true" aria-label={t("Apro la call")}>
      <div className="call-doc">
        <div className="call-bar" />
        <div className="call-col">
          <span className="skeleton sk-title" />
          <span className="skeleton sk-meta" />
          <div className="skeleton-lines">
            {[96, 88, 92, 70, 84, 64].map((w, i) => (
              <span key={i} className="skeleton" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
