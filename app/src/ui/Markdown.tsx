import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown-logic";
import { t } from "../i18n";

// Renders what an LLM wrote (summary, chat answer, follow-up) as real structure:
// headings, lists, bold — and citations that open the call they come from.
// Nothing is injected as HTML: the tree comes from markdown-logic.ts.

export type Cite = { title: string };

export default function Markdown<S extends Cite>({
  text,
  sources = [],
  onCite,
  compact = false,
  className = "",
}: {
  text: string;
  sources?: S[];
  onCite?: (s: S) => void;
  /** Chat bubbles: tighter rhythm, smaller headings. */
  compact?: boolean;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text, sources), [text, sources]);

  const inline = (xs: Inline[], key = ""): ReactNode =>
    xs.map((x, i) => {
      const k = `${key}${i}`;
      switch (x.t) {
        case "text":
          return <Fragment key={k}>{x.v}</Fragment>;
        case "b":
          return <strong key={k}>{inline(x.c, k + ".")}</strong>;
        case "i":
          return <em key={k}>{inline(x.c, k + ".")}</em>;
        case "code":
          return <code key={k}>{x.v}</code>;
        case "cite": {
          const s = x.source !== null ? sources[x.source] : undefined;
          if (!s || !onCite) return <span key={k} className="md-cite-off">[{x.label}]</span>;
          return (
            <button key={k} className="md-cite" title={t("Apri “{title}”", { title: s.title })} onClick={() => onCite(s)}>
              {x.label}
            </button>
          );
        }
      }
    });

  const block = (b: Block, i: number): ReactNode => {
    switch (b.t) {
      case "h": {
        const Tag = (["h3", "h4", "h5"] as const)[b.level - 1];
        return <Tag key={i}>{inline(b.c, `${i}.`)}</Tag>;
      }
      case "p":
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${i}.${j}.`)}
              </Fragment>
            ))}
          </p>
        );
      case "ul":
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}.${j}.`)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} start={b.start}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}.${j}.`)}</li>
            ))}
          </ol>
        );
      case "hr":
        return <hr key={i} />;
    }
  };

  return <div className={["md", compact ? "md-compact" : "", className].filter(Boolean).join(" ")}>{blocks.map(block)}</div>;
}
