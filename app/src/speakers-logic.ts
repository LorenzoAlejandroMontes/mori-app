// "Interlocutore" → a name. The recorder only knows two voices: the mic ("Tu")
// and the computer's audio ("Interlocutore", everyone else). Once the user says
// who that was, the name is used everywhere the transcript is read: the
// transcript view, ⌘K search, the recall chunks and what organize sends to the
// model (which can then say WHO promised what).
//
// The map lives in session.metadata_json (`{"speakers": {...}}`), so no schema
// change. Pure: no DB, for scripts/checks.mjs.
import { t } from "./i18n";

export type SpeakerMap = Record<string, string>;

/** Labels the recorder writes; "Tu" is the user and is never renamed here. */
export const OTHER_LABELS = ["Interlocutore"];

export function parseSpeakerMap(metadataJson: string | null | undefined): SpeakerMap {
  try {
    const m = JSON.parse(metadataJson || "{}");
    const sp = m && typeof m === "object" ? m.speakers : null;
    if (!sp || typeof sp !== "object") return {};
    const out: SpeakerMap = {};
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
    return out;
  } catch {
    return {};
  }
}

/** The metadata with the new map, every other key left as it was. */
export function withSpeakerMap(metadataJson: string | null | undefined, map: SpeakerMap): string {
  let m: Record<string, unknown> = {};
  try {
    const p = JSON.parse(metadataJson || "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) m = p;
  } catch {
    /* a broken blob is replaced */
  }
  const clean: SpeakerMap = {};
  for (const [k, v] of Object.entries(map)) if (v.trim()) clean[k] = v.trim();
  if (Object.keys(clean).length) m.speakers = clean;
  else delete m.speakers;
  return JSON.stringify(m);
}

/** A speaker as shown on screen: the recorder's labels in the UI language,
 *  any other name as it is. The stored data keeps "Tu" / "Interlocutore". */
export function speakerLabel(label: string): string {
  if (label === "Tu") return t("Tu");
  if (label === "Interlocutore") return t("Interlocutore");
  return label;
}

export function speakerName(label: string, map: SpeakerMap): string {
  return map[label] ?? label;
}

export function applySpeakerMap<T extends { speaker: string }>(segments: T[], map: SpeakerMap): T[] {
  if (!Object.keys(map).length) return segments;
  return segments.map((s) => (map[s.speaker] ? { ...s, speaker: map[s.speaker] } : s));
}

/** "Interlocutore: …" at the start of a line becomes "Giulia: …". */
export function relabelText(text: string, map: SpeakerMap): string {
  let out = text;
  for (const [label, name] of Object.entries(map)) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^(\\s*)${esc}(\\s*:)`, "gm"), `$1${name}$2`);
  }
  return out;
}

/** The other-voice labels that actually appear in a transcript. */
export function otherLabelsIn(segments: { speaker: string }[], memo: string): string[] {
  const found = new Set<string>();
  for (const s of segments) if (OTHER_LABELS.includes(s.speaker)) found.add(s.speaker);
  for (const l of OTHER_LABELS) if (new RegExp(`^\\s*${l}\\s*:`, "m").test(memo)) found.add(l);
  return [...found];
}
