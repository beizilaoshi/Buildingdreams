import config from './playwright.config';
export default { ...config, testMatch: 'launch-ui.spec.ts', timeout: 60000 };
