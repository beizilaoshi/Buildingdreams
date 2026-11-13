import { PNG } from "pngjs";
import type { AccountAppearance } from "../../shared/types";

const limit = 65536;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function textureUrl(value: unknown, legacy = false): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  let url = value;
  // Old Mojang session payloads use HTTP; upgrade only this exact official URL.
  if (legacy && /^http:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]{64}$/i.test(url))
    url = "https:" + url.slice(5);
  return /^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]{64}$/i.test(url)
    ? url : null;
}
/** Deliberately store only the active, validated public texture, never the profile/token. */
export function activeTexture(profile: any): string | null {
  if (!Array.isArray(profile?.skins)) return null;
  return textureUrl(profile.skins.find((skin: any) => skin?.state === "ACTIVE")?.url);
}
function validateSkinContainer(data: Buffer): void {
  if (data.length < 33 || !data.subarray(0, 8).equals(signature) || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR" || data.readUInt32BE(16) !== 64 || ![32, 64].includes(data.readUInt32BE(20)) || data[28] !== 0) throw new Error();
  // pngjs accepts repeated headers. Never let a later header bypass the allocation bounds.
  for (let offset = 33; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const end = offset + length + 12;
    if (end > data.length || type === "IHDR") throw new Error();
    if (type === "IEND") {
      if (length !== 0 || end !== data.length) throw new Error();
      return;
    }
    offset = end;
  }
  throw new Error();
}
export class AppearanceService {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async read(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url, { redirect: "error", signal: controller.signal });
      if (!response.ok || response.redirected || !response.body) throw new Error();
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error();
      reader = response.body.getReader();
      let size = 0;
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error();
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
    }
  }
  async get(accountId: string, uuid: string, kind: "microsoft" | "local", texture: string | null | undefined): Promise<AccountAppearance> {
    const fallback = (reason: "local" | "missing" | "unavailable"): AccountAppearance => ({ accountId, source: "default", reason });
    if (kind === "local") return fallback("local");
    try {
      let url = texture;
      if (url === undefined) {
        if (!/^[a-f0-9]{32}$/i.test(uuid)) throw new Error();
        const profile = JSON.parse((await this.read("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid)).toString("utf8"));
        if (profile.id?.toLowerCase() !== uuid.toLowerCase()) throw new Error();
        const value = profile.properties?.find((p: any) => p?.name === "textures")?.value;
        if (!value) return fallback("missing");
        if (typeof value !== "string" || value.length > 48000) throw new Error();
        const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
        if (decoded.profileId?.toLowerCase() !== uuid.toLowerCase()) throw new Error();
        if (!decoded.textures?.SKIN) return fallback("missing");
        url = textureUrl(decoded.textures.SKIN.url, true);
        if (!url) throw new Error();
      }
      if (url === null) return fallback("missing");
      url = textureUrl(url);
      if (!url) throw new Error();
      const data = await this.read(url);
      // Bound allocation before invoking the PNG decoder, then validate CRCs/decompression.
      validateSkinContainer(data);
      const image = PNG.sync.read(data, { checkCRC: true });
      const png = PNG.sync.write(image);
      if (png.length > limit) throw new Error();
      return { accountId, source: "official", png: "data:image/png;base64," + png.toString("base64") };
    } catch {
      return fallback("unavailable");
    }
  }
}
