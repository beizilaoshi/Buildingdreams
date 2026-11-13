import config from '../playwright.config';
export default {...config,testDir:'.',testMatch:'live-background-ui.spec.ts',timeout:60000};
