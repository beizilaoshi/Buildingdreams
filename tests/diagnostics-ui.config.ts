import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'diagnostics-ui.spec.ts', timeout: 60000 };
