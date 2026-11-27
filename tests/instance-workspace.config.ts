import config from '../playwright.config';
export default { ...config, testDir: '.', testMatch: 'instance-workspace.spec.ts' };
