import config from '../playwright.config';
export default {...config,testDir:'.',outputDir:'../validation/parity-ui-results',testMatch:['diagnostics-ui.spec.ts','instance-workspace.spec.ts']};
