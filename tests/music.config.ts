import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'music-ui.spec.ts',workers:1,timeout:60000,use:{trace:'retain-on-failure'}});
