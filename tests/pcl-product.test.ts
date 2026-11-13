import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ packaged: false, worker: "" }));
vi.mock("electron", () => ({ app: { get isPackaged() { return state.packaged; }, getPath: () => "user-data", getAppPath: () => "app-root", on: vi.fn() }, dialog: {} }));
vi.mock("../src/main/services/pcl-bridge", () => ({ PclBridge: class {}, privatePclRuntime: (_data: string, worker: string) => { state.worker = worker; } }));
import { productPclBridge } from "../src/main/services/pcl-product";
import { join } from "node:path";
test("development uses Release worker, packaged app uses external resources", () => {
  state.packaged = false;
  productPclBridge();
  expect(state.worker).toBe(join("app-root", "tools", "pcl-bridge", "bin", "Release"));
  state.packaged = true;
  Object.defineProperty(process, "resourcesPath", { value: "installed-resources", configurable: true });
  productPclBridge();
  expect(state.worker).toBe(join("installed-resources", "pcl-bridge"));
});
