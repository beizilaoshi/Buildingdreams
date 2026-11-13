import { defineConfig } from "@playwright/test";
delete process.env.NO_COLOR;
export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  workers: 1,
  timeout: 30000,
  use: { trace: "retain-on-failure" },
});
