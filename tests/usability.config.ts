import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'usability-*.spec.ts' };
