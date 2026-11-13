import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'update-ui.spec.ts' };
