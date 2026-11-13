export interface MinecraftVersion {
  id: string;
  url: string;
  type?: string;
  sha1?: string;
  releaseTime?: string;
}
// Numeric chronology shared by catalogue consumers (legacy 1.x and calendar 26.x).
export function compareMinecraftNames(a: string, b: string): number {
  const parts = (value: string) =>
    /^1\.(\d+)(?:\.(\d+))?$/.exec(value)
      ? [Number(value.split(".")[1]), 0, Number(value.split(".")[2] ?? 0)]
      : /^(\d{2,})\.(\d+)(?:\.(\d+))?$/.test(value)
        ? value.split(".").map(Number)
        : undefined;
  const x = parts(a),
    y = parts(b);
  if (!x || !y) return x ? -1 : y ? 1 : b.localeCompare(a);
  for (let i = 0; i < 3; i++) {
    const n = (y[i] ?? 0) - (x[i] ?? 0);
    if (n) return n;
  }
  return 0;
}
export interface MinecraftCatalog {
  latest: { release?: string; snapshot?: string };
  versions: MinecraftVersion[];
}
export type MinecraftGroup = "release" | "snapshot" | "ancient" | "fool";
const fools = new Set([
  "20w14infinite",
  "20w14∞",
  "3d shareware v1.34",
  "1.rv-pre1",
  "15w14a",
  "2.0",
  "22w13oneblockatatime",
  "23w13a_or_b",
  "24w14potato",
  "25w14craftmine",
  "26w14a",
]);
// Selectively ported from PCL 2.12.7.3 PageDownloadInstall.LoadMinecraft (see provenance).
export function minecraftGroup(item: {
  id: string;
  type?: string;
  releaseTime?: string;
}): MinecraftGroup {
  if (item.type === "special") return "fool";
  if (item.type === "release") return "release";
  if (item.type !== "snapshot") return "ancient";
  const id = item.id.toLowerCase();
  const date = new Date(Date.parse(item.releaseTime ?? "") + 7200000);
  if (fools.has(id) || (date.getUTCMonth() === 3 && date.getUTCDate() === 1))
    return "fool";
  if (
    id.startsWith("1.") &&
    !["combat", "rc", "experimental", "pre"].some((x) => id.includes(x))
  )
    return "release";
  return "snapshot";
}
export function sortMinecraftVersions<
  T extends { id: string; releaseTime?: string },
>(items: T[]): T[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        (Date.parse(b.releaseTime ?? "") || 0) -
        (Date.parse(a.releaseTime ?? "") || 0),
    );
}
