import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'home-content-ui.spec.ts',workers:1,timeout:30000});
