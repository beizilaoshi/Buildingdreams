import { defineConfig } from "@playwright/test";
delete process.env.NO_COLOR;
export default defineConfig({ testDir: "./tests", testMatch: ["feedback-ui.spec.ts", "content-ui.spec.ts", "curseforge-ui.spec.ts", "content-localization-ui.spec.ts", "java-ui.spec.ts"], workers: 1, timeout: 60000, use: { trace: "retain-on-failure" } });
