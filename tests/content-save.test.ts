import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm, lstat } from "node:fs/promises";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ContentSaveService } from "../src/main/services/content-save";
import { NetworkService } from "../src/main/services/network";
import { TaskService } from "../src/main/services/tasks";
import { ModrinthService } from "../src/main/services/modrinth";
it("save cancel starts no task; selected exact file is verified and hash failure preserves destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-save-"));
  const path = join(root, "saved.jar");
  try {
    await writeFile(path, "old");
    let corrupt = true,
      cancelled = true;
    const bytes = Buffer.from("new verified file");
    const network = new NetworkService({
      fetch: (async (url: any) =>
        new Response(
          String(url).includes("/version/")
            ? JSON.stringify({
                id: "v",
                project_id: "p",
                name: "v",
                version_number: "v",
                date_published: "2026-01-01",
                game_versions: [],
                loaders: [],
                dependencies: [],
                files: [
                  {
                    filename: "a.jar",
                    url: "https://cdn.modrinth.com/a.jar",
                    size: bytes.length,
                    primary: true,
                    hashes: {
                      sha1: createHash("sha1").update(bytes).digest("hex"),
                    },
                  },
                ],
              })
            : corrupt
              ? Buffer.alloc(bytes.length)
              : bytes,
        )) as typeof fetch,
    });
    const tasks = new TaskService();
    const save = new ContentSaveService(
      new ModrinthService(network),
      network,
      tasks,
      async () => (cancelled ? null : path),
    );
    expect(await save.save("p", "v", "a.jar")).toBeNull();
    expect(tasks.list()).toHaveLength(0);
    cancelled = false;
    const bad = await save.save("p", "v", "a.jar");
    await expect(tasks.wait(bad!)).rejects.toThrow("SHA1");
    expect(await readFile(path, "utf8")).toBe("old");
    corrupt = false;
    const good = await save.save("p", "v", "a.jar");
    await tasks.wait(good!);
    expect(await readFile(path, "utf8")).toBe(bytes.toString());
    await expect(save.save("wrong", "v", "a.jar")).rejects.toThrow();
    await expect(save.save("p", "v", "missing.jar")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("cancellation at final destination safety await cannot publish or replace existing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-cancel-")),
    path = join(root, "saved.jar");
  const controller = new AbortController();
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (file: any, ...args: any[]) => {
    const info = await (actual.lstat as any)(file, ...args);
    if (String(file) === path && ++calls === 2) controller.abort();
    return info;
  }) as any);
  try {
    await writeFile(path, "old");
    const bytes = Buffer.from("replacement");
    const network = new NetworkService({
      fetch: (async () => new Response(bytes)) as typeof fetch,
    });
    await expect(
      network.download(
        root,
        {
          url: "https://cdn.modrinth.com/file",
          path: "saved.jar",
          size: bytes.length,
        },
        { signal: controller.signal, report() {} },
      ),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("old");
  } finally {
    vi.mocked(lstat).mockImplementation(actual.lstat);
    await rm(root, { recursive: true, force: true });
  }
});
