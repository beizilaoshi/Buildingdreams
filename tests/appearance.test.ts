import { expect, test, vi } from "vitest";
import { PNG } from "pngjs";
import { AppearanceService, activeTexture } from "../src/main/services/appearance";
const uuid = "0123456789abcdef0123456789abcdef";
const url = "https://textures.minecraft.net/texture/" + "a".repeat(64);
function skin(height = 64) {
  const png = new PNG({ width: 64, height });
  png.data.fill(0);
  for (const [x, y, rgba] of [[8, 8, [200, 90, 40, 255]], [40, 8, [20, 180, 240, 128]]] as const)
    png.data.set(rgba, (y * 64 + x) * 4);
  return PNG.sync.write(png);
}
function service(replies: (Response | Error)[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const s = new AppearanceService(async (input, init) => {
    requests.push({ url: String(input), init });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    if (!r) throw new Error("Unexpected request");
    return r;
  });
  return { s, requests };
}
test("only ACTIVE official textures are persisted, rejecting arbitrary destinations", () => {
  expect(activeTexture({ skins: [{ state: "INACTIVE", url: "https://evil.invalid/a" }, { state: "ACTIVE", url }] })).toBe(url);
  for (const bad of ["http://textures.minecraft.net/texture/" + "a".repeat(64), "https://textures.minecraft.net.evil/texture/" + "a".repeat(64), url + "?token=SECRET", "https://user@textures.minecraft.net/texture/" + "a".repeat(64)])
    expect(activeTexture({ skins: [{ state: "ACTIVE", url: bad }] })).toBeNull();
});
test.each([32, 64])("official %i pixel skin is decoded and returned as bounded PNG without credentials", async (height) => {
  const { s, requests } = service([new Response(new Uint8Array(skin(height)))]);
  const result = await s.get("account", uuid, "microsoft", url);
  expect(result.source).toBe("official");
  if (result.source !== "official") throw new Error("missing skin");
  const decoded = PNG.sync.read(Buffer.from(result.png.split(",")[1], "base64"));
  expect([decoded.width, decoded.height]).toEqual([64, height]);
  expect([...decoded.data.subarray((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4)]).toEqual([200, 90, 40, 255]);
  expect(result.png.length).toBeLessThan(24000);
  expect(requests[0].init?.headers).toBeUndefined();
  expect(requests[0].init?.redirect).toBe("error");
});
test("legacy official account resolves a UUID-bound public profile over HTTPS", async () => {
  const value = Buffer.from(JSON.stringify({ profileId: uuid, textures: { SKIN: { url: url.replace("https:", "http:") } } })).toString("base64");
  const { s, requests } = service([new Response(JSON.stringify({ id: uuid, properties: [{ name: "textures", value }] })), new Response(new Uint8Array(skin()))]);
  expect((await s.get("legacy", uuid, "microsoft", undefined)).source).toBe("official");
  expect(requests.map((r) => r.url)).toEqual(["https://sessionserver.mojang.com/session/minecraft/profile/" + uuid, url]);
  expect(requests.every((r) => !r.init?.headers)).toBe(true);
});
test("local and explicitly missing textures use honest defaults without networking", async () => {
  const { s, requests } = service([]);
  expect(await s.get("a", uuid, "local", undefined)).toMatchObject({ source: "default", reason: "local" });
  expect(await s.get("a", uuid, "microsoft", null)).toMatchObject({ source: "default", reason: "missing" });
  expect(requests).toEqual([]);
});
test("rejects invalid, oversized, redirected, untrusted textures and offline errors", async () => {
  const dimension = skin();
  dimension.writeUInt32BE(999999, 16);
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); controller.close(); } });
  for (const reply of [new Response("not a PNG"), new Response(new Uint8Array(dimension)), new Response(tooLarge), new Response("", { status: 302, headers: { location: "https://evil.invalid" } }), new Error("SECRET")]) {
    const { s } = service([reply]);
    expect(await s.get("a", uuid, "microsoft", url)).toEqual({ accountId: "a", source: "default", reason: "unavailable" });
  }
  const { s, requests } = service([]);
  expect((await s.get("a", uuid, "microsoft", "https://evil.invalid/a")).source).toBe("default");
  expect(requests).toEqual([]);
});
test("appearance request and body are cancelled at the deadline", async () => {
  vi.useFakeTimers();
  try {
    let aborted = false;
    const s = new AppearanceService(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("timeout")); });
    }));
    const pending = s.get("a", uuid, "microsoft", url);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ source: "default", reason: "unavailable" });
    expect(aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});
test("rejects a second PNG header before decoding untrusted dimensions", async () => {
  const original = skin();
  const other = PNG.sync.write(new PNG({ width: 32, height: 64 }));
  const duplicate = Buffer.concat([original.subarray(0, 33), other.subarray(8, 33), original.subarray(33)]);
  const { s } = service([new Response(new Uint8Array(duplicate))]);
  expect((await s.get("a", uuid, "microsoft", url)).source).toBe("default");
});
test("public profile cannot substitute another player's identity or arbitrary hosts", async () => {
  for (const payload of [
    { id: "f".repeat(32), properties: [] },
    { id: uuid, properties: [{ name: "textures", value: Buffer.from(JSON.stringify({ profileId: "f".repeat(32), textures: { SKIN: { url } } })).toString("base64") }] },
    { id: uuid, properties: [{ name: "textures", value: Buffer.from(JSON.stringify({ profileId: uuid, textures: { SKIN: { url: "https://evil.invalid/skin" } } })).toString("base64") }] },
  ]) {
    const { s, requests } = service([new Response(JSON.stringify(payload))]);
    expect((await s.get("a", uuid, "microsoft", undefined)).source).toBe("default");
    expect(requests).toHaveLength(1);
  }
});
