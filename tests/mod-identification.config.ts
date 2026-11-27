import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'mod-identification-ui.spec.ts',workers:1,timeout:30000});
