// Mori's mark: a lowercase "m" drawn as two arches — the two voices Mori
// listens to, you (teal) and the other side (violet), one continuous stroke.
// Reads at 14 px in the rail and at 1024 px as the app icon. `tone="mono"`
// draws it in the current text color, for places where the gradient would
// shout (a disabled state, a print).
import { useId } from "react";

export default function Dragon({ size = 22, tone = "duo" }: { size?: number; tone?: "duo" | "mono" }) {
  const id = useId();
  return (
    <svg className="mori-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {tone === "duo" && (
        <defs>
          <linearGradient id={id} x1="4" y1="12" x2="20" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--mark-a, #0d9488)" />
            <stop offset="1" stopColor="var(--mark-b, #7c3aed)" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M4 19V11.5a4 4 0 0 1 8 0V19M12 11.5a4 4 0 0 1 8 0V19"
        stroke={tone === "duo" ? `url(#${id})` : "currentColor"}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The wordmark next to the mark: "Mori" set in the display serif. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="mori-brand" style={{ fontSize: size }}>
      <Dragon size={size} />
      <span className="mori-wordmark">Mori</span>
    </span>
  );
}
