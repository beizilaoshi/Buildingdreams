import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'feedback-ui.spec.ts', timeout: 60000 };
