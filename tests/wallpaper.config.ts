import config from '../playwright.config';
export default {...config,testDir:'.',testMatch:'wallpaper-ui.spec.ts',timeout:45000};
