import { describe, it, expect } from "vitest";
import { validateArchive } from "../src/main/services/archive";
describe("archive boundaries", () => {
  it.each(["../x", "C:/x", "a\\..\\x", "/root", "a:stream", "CON", "a/../b"])(
    "rejects %s",
    (path) => expect(() => validateArchive([{ path, size: 1 }])).toThrow(),
  );
  it("rejects collisions, links and bombs", () => {
    expect(() =>
      validateArchive([
        { path: "A", size: 1 },
        { path: "a", size: 1 },
      ]),
    ).toThrow();
    expect(() =>
      validateArchive([{ path: "x", size: 1, symlink: true }]),
    ).toThrow();
    expect(() => validateArchive([{ path: "x", size: 9e12 }])).toThrow();
  });
  it("accepts contained files", () =>
    expect(() =>
      validateArchive([{ path: "overrides/config/a.json", size: 3 }]),
    ).not.toThrow());
});
import { ZipFile } from "yazl";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { readArchive } from "../src/main/services/archive";
it("prevalidates real ZIP collision, symlink, traversal and declared bomb fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "archive-"));
  try {
    for (const kind of ["collision", "symlink", "traversal", "bomb"]) {
      const path = join(root, kind + ".zip"),
        z = new ZipFile();
      z.addBuffer(Buffer.from("data"), "aaa", {
        mode: kind === "symlink" ? 0o120777 : 0o100644,
      });
      if (kind === "collision") z.addBuffer(Buffer.from("second"), "AAA");
      z.end();
      await pipeline(z.outputStream, createWriteStream(path));
      if (kind === "traversal" || kind === "bomb") {
        const b = await readFile(path);
        for (let i = 0; i < b.length - 46; i++) {
          if (b.readUInt32LE(i) === 0x02014b50) {
            if (kind === "traversal") b.write("../", i + 46);
            else b.writeUInt32LE(0xffffffff, i + 24);
          }
          if (kind === "traversal" && b.readUInt32LE(i) === 0x04034b50)
            b.write("../", i + 30);
        }
        await writeFile(path, b);
      }
      await expect(readArchive(path)).rejects.toThrow();
    }
    const bad = join(root, "bad.zip");
    await writeFile(bad, "not a zip");
    await expect(readArchive(bad)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
