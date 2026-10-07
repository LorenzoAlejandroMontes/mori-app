// Config usata SOLO dal banco di prova (preview/), per guardare i componenti
// renderizzati fuori da Tauri. Non entra nel build dell'app.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "preview",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@tauri-apps/plugin-sql", replacement: here("./preview/stub-sql.ts") },
      { find: "@tauri-apps/api/core", replacement: here("./preview/stub-core.ts") },
      { find: "@tauri-apps/api/event", replacement: here("./preview/stub-core.ts") },
      { find: "@tauri-apps/api/window", replacement: here("./preview/stub-core.ts") },
      { find: "@tauri-apps/plugin-http", replacement: here("./preview/stub-core.ts") },
    ],
  },
  build: { outDir: "../preview-dist", emptyOutDir: true },
});
