import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  root: "src/renderer",
  publicDir: resolve("public"),
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
