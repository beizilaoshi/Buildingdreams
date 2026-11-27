import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture } from "./minecraft-fixture";
import { InstanceService } from "../src/main/services/instances";
import { InstanceFiles } from "../src/main/services/instance-files";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

it("lists instance folders and nested files for the in-app browser", async () => {
  const root = await fixture(); roots.push(root);
  const instances = new InstanceService();
  const [instance] = await instances.importDirectory(root);
  await mkdir(join(root, "saves", "Dream"), { recursive: true });
  await writeFile(join(root, "saves", "Dream", "level.dat"), "world");
  const files = new InstanceFiles(instances);

  const saves = await files.browse(instance.id, "saves");
  expect(saves.entries).toMatchObject([{ name: "Dream", kind: "directory" }]);
  const world = await files.browse(instance.id, "saves", "Dream");
  expect(world.entries).toMatchObject([{ name: "level.dat", kind: "file", size: 5 }]);
});

it("rejects traversal and symlinks outside the selected instance folder", async () => {
  const parent = await mkdtemp(join(tmpdir(), "zhumeng-file-boundary-")); roots.push(parent);
  const root = await fixture(); roots.push(root);
  const instances = new InstanceService(); const [instance] = await instances.importDirectory(root);
  const outside = join(parent, "outside"); await mkdir(outside); await writeFile(join(outside, "secret.txt"), "secret");
  const files = new InstanceFiles(instances);
  await expect(files.browse(instance.id, "root", "../outside")).rejects.toThrow();
  await expect(files.browse(instance.id, "root", outside)).rejects.toThrow();
});

it("pages through large instance directories instead of hiding everything after item 500", async () => {
  const root = await fixture(); roots.push(root);
  const instances = new InstanceService(); const [instance] = await instances.importDirectory(root);
  const mods = join(root, "mods"); await mkdir(mods);
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(mods, `item-${String(index).padStart(3, "0")}.jar`), "x")));
  const files = new InstanceFiles(instances);
  const first = await files.browse(instance.id, "mods");
  expect(first.entries).toHaveLength(500);
  expect(first.nextOffset).toBe(500);
  const second = await (files.browse as any)(instance.id, "mods", "", first.nextOffset);
  expect(second.entries).toMatchObject([{ name: "item-500.jar" }]);
  expect(second.nextOffset).toBeUndefined();
});
