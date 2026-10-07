// A small, safe Markdown reader for what LLMs actually write in Mori: headings,
// bullet and numbered lists, **bold**, *italic*, `code`, and — the part that
// matters — citations like [Call con Marco — 19 ago 2026], which become chips
// that open the call. It builds a tree of plain data (no HTML strings, nothing
// for dangerouslySetInnerHTML), rendered by Markdown.tsx.
//
// Pure: no React, no DB, so scripts/checks.mjs can run it as is.

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  /** `source` is the index into the sources the answer came with, or null when
   *  the model cited something we did not give it (then it is plain text). */
  | { t: "cite"; label: string; source: number | null };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; lines: Inline[][] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "hr" };

export type CiteTarget = { title: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Which source a citation label points at: "[Titolo — data]", "[Titolo]",
 *  or a title the model shortened. Null when nothing fits. */
export function matchCitation(label: string, sources: CiteTarget[]): number | null {
  if (!sources.length) return null;
  // The title is what comes before the " — date" (or " - date") tail.
  const title = norm(label.split(/\s+[—–-]\s+/)[0] ?? label);
  const whole = norm(label);
  if (!title) return null;
  let best: number | null = null;
  let bestLen = 0;
  sources.forEach((s, i) => {
    const t = norm(s.title);
    if (!t) return;
    const hit =
      t === title ||
      t === whole ||
      (title.length >= 6 && t.startsWith(title)) ||
      (t.length >= 6 && title.startsWith(t));
    // The longest matching title wins: "Call" must not steal "Call con Marco".
    if (hit && t.length > bestLen) {
      best = i;
      bestLen = t.length;
    }
  });
  return best;
}

// Order matters: links before citations, bold before italic.
const INLINE_RE =
  /\[([^\]\n]{1,160})\]\((?:[^)\s]{1,400})\)|\*\*([^*\n]+?)\*\*|`([^`\n]+)`|\[([^\]\n]{2,160})\]|(?<![\p{L}\p{N}*])\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}*])/gu;

export function parseInline(text: string, sources: CiteTarget[] = []): Inline[] {
  const out: Inline[] = [];
  const push = (n: Inline) => {
    const last = out[out.length - 1];
    if (n.t === "text" && last?.t === "text") last.v += n.v;
    else if (n.t !== "text" || n.v) out.push(n);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    if (i > at) push({ t: "text", v: text.slice(at, i) });
    if (m[1] !== undefined) {
      // [text](url): keep the words, drop the link — Mori opens nothing external.
      push({ t: "text", v: m[1] });
    } else if (m[2] !== undefined) {
      push({ t: "b", c: parseInline(m[2], sources) });
    } else if (m[3] !== undefined) {
      push({ t: "code", v: m[3] });
    } else if (m[4] !== undefined) {
      const label = m[4].trim();
      // "[x]" checkbox-like or a lone number is not a citation.
      if (/^[\sxX]$|^\d+$/.test(label)) push({ t: "text", v: m[0] });
      else push({ t: "cite", label, source: matchCitation(label, sources) });
    } else if (m[5] !== undefined) {
      push({ t: "i", c: parseInline(m[5], sources) });
    }
    at = i + m[0].length;
  }
  if (at < text.length) push({ t: "text", v: text.slice(at) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

// Headings and rules are read by hand: the obvious regexes backtrack on long
// runs of spaces (a "# x" + 4000 spaces + "#y" line took 22 s), and a chat
// answer is re-parsed at every streamed word. Everything below is linear.

/** "## Title ##" → level 2, "Title". Null when the line is not a heading. */
export function readHeading(line: string): { level: number; text: string } | null {
  let i = 0;
  while (i < line.length && /\s/.test(line[i])) i++;
  let hashes = 0;
  while (i + hashes < line.length && line[i + hashes] === "#") hashes++;
  if (hashes < 1 || hashes > 6) return null;
  const rest = line.slice(i + hashes);
  if (rest.length && !/\s/.test(rest[0])) return null; // "#hashtag" is not a heading
  let text = rest.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end < text.length && (end === 0 || /\s/.test(text[end - 1]))) text = text.slice(0, end).trimEnd();
  return { level: hashes, text };
}

/** "---", "* * *", "___": a horizontal rule. */
export function isRule(line: string): boolean {
  const t = line.replace(/\s+/g, "");
  return t.length >= 3 && (/^-+$/.test(t) || /^\*+$/.test(t) || /^_+$/.test(t));
}

export function parseMarkdown(src: string, sources: CiteTarget[] = []): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  let list: { kind: "ul" | "ol"; items: Inline[][]; start: number } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list.kind === "ul" ? { t: "ul", items: list.items } : { t: "ol", items: list.items, start: list.start });
    list = null;
  };

  for (const raw of (src ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd(); // linear: /\s+$/ backtracks on long runs of spaces
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = readHeading(line);
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(3, Math.max(1, h.level - 1)) as 1 | 2 | 3;
      blocks.push({ t: "h", level, c: parseInline(h.text, sources) });
      continue;
    }
    if (isRule(line)) {
      flushPara();
      flushList();
      blocks.push({ t: "hr" });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const kind = b ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [], start: n ? Number(n[1]) : 1 };
      }
      list.items.push(parseInline(b ? b[1] : n![2], sources));
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s{2,}\S/.test(raw)) {
      const last = list.items[list.items.length - 1];
      last.push({ t: "text", v: " " }, ...parseInline(line.trim(), sources));
      continue;
    }
    flushList();
    para.push(parseInline(line.trim(), sources));
  }
  flushPara();
  flushList();
  return blocks;
}

/** The indices of the sources an answer actually cites, in order of first use. */
export function citedSources(blocks: Block[]): number[] {
  const seen: number[] = [];
  const walk = (xs: Inline[]) => {
    for (const x of xs) {
      if (x.t === "cite" && x.source !== null && !seen.includes(x.source)) seen.push(x.source);
      else if (x.t === "b" || x.t === "i") walk(x.c);
    }
  };
  for (const b of blocks) {
    if (b.t === "h") walk(b.c);
    else if (b.t === "p") b.lines.forEach(walk);
    else if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
  }
  return seen;
}
