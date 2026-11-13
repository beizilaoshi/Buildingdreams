import config from "../playwright.config";
export default { ...config, testDir: ".", testMatch: "customization-settings-ui.spec.ts", timeout: 45000 };
