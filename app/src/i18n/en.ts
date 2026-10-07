// The English dictionary: Italian text → English text, one file per area of
// the app (src/i18n/en/*.ts) so each can be read next to the views it
// belongs to. Picked up automatically: a new area file needs no wiring.
const areas = import.meta.glob<{ default: Record<string, string> }>("./en/*.ts", { eager: true });

export const EN: Record<string, string> = Object.assign({}, ...Object.values(areas).map((m) => m.default));
