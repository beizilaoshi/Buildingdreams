import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'customization-ui.spec.ts', timeout: 60000 };
