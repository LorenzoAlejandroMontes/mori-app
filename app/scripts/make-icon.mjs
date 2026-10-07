// Writes the app icon source (src-tauri/icon-src.svg): Mori's mark — the "m"
// of two arches, teal to violet — on a dark rounded tile. Then:
//
//   node scripts/make-icon.mjs
//   pnpm exec tauri icon src-tauri/icon-src.svg     # the whole icon set
//
// The same path is in src/ui/Mark.tsx: change one, change both.
import { writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="m" x1="4" y1="12" x2="20" y2="12" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14b8a6"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="60%">
      <stop stop-color="#2a2f3a"/>
      <stop offset="1" stop-color="#121418"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#glow)"/>
  <!-- the mark, drawn on the 24-unit grid of Mark.tsx scaled ×32, centred -->
  <g transform="translate(128 128) scale(32)">
    <path d="M4 19V11.5a4 4 0 0 1 8 0V19M12 11.5a4 4 0 0 1 8 0V19" fill="none" stroke="url(#m)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;

writeFileSync("src-tauri/icon-src.svg", svg);
console.log("wrote src-tauri/icon-src.svg (1024×1024)");
