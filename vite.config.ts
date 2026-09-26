import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: { input: { outil: resolve(__dirname, "outil.html") } },
  },
  worker: { format: "es" },
});
