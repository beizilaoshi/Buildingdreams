import type { ContentVersion, ContentKind } from "./content";
import { compareMinecraftNames } from "./minecraft-versions";
export interface ContentGroup {
  key: string;
  minecraft: string;
  loader: string;
  recommended: boolean;
  versions: ContentVersion[];
}
function groupName(game: string, minor = false, old = false): string {
  if (game === "其他") return game;
  if (/w\d|snapshot/i.test(game)) return "快照版";
  const legacy = /^1\.(\d+)(?:\.\d+)?$/.exec(game);
  const modern = /^\d{2,}\.\d+(?:\.\d+)?$/.test(game);
  if ((!legacy && !modern) || (old && legacy && Number(legacy[1]) < 20))
    return "远古版";
  return minor ? game.split(".").slice(0, 2).join(".") : game;
}
export function versionFilters(versions: ContentVersion[]) {
  const games = [...new Set(versions.flatMap((v) => v.game_versions))];
  let label = (game: string) => game;
  let labels: string[] = [];
  for (const [minor, old] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    label = (game: string) => groupName(game, minor, old);
    labels = [...new Set(games.map(label))].sort(compareMinecraftNames);
    if (labels.length < 9) break;
  }
  return { label, labels };
}
export function contentGroups(
  versions: ContentVersion[],
  type: ContentKind,
  targetMC = "",
  targetLoader = "",
): ContentGroup[] {
  const groups = new Map<string, ContentGroup>();
  const seen = new Map<string, Set<string>>();
  for (const version of versions)
    for (const mc of new Set(
      version.game_versions.length ? version.game_versions : ["其他"],
    )) {
      const loaders =
        type === "mod"
          ? [
              ...new Set(
                version.loaders.filter((l) =>
                  ["fabric", "forge", "neoforge", "quilt"].includes(l),
                ),
              ),
            ]
          : [""];
      for (const loader of loaders.length ? loaders : [""]) {
        const groupedMC = groupName(mc);
        const key = [loader, groupedMC].filter(Boolean).join(" ");
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            minecraft: groupedMC,
            loader,
            recommended: false,
            versions: [],
          };
          groups.set(key, group);
        }
        let ids = seen.get(key);
        if (!ids) {
          ids = new Set();
          seen.set(key, ids);
        }
        if (!ids.has(version.id)) {
          ids.add(version.id);
          group.versions.push(version);
        }
      }
    }
  const recommended = targetMC
    ? versions.filter(
        (v) =>
          v.game_versions.includes(targetMC) &&
          (!targetLoader ||
            type !== "mod" ||
            v.loaders.includes(targetLoader)),
      )
    : [];
  if (recommended.length) {
    const loader = type === "mod" ? targetLoader : "";
    const key = [loader, targetMC].filter(Boolean).join(" ");
    if (!targetLoader)
      for (const [normalKey, group] of groups)
        if (group.minecraft === targetMC) groups.delete(normalKey);
    groups.set(key, {
      key,
      minecraft: targetMC,
      loader,
      recommended: true,
      versions: [...new Map(recommended.map((v) => [v.id, v])).values()],
    });
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        compareMinecraftNames(a.minecraft, b.minecraft) ||
        a.loader.localeCompare(b.loader),
    )
    .map((g) => ({
      ...g,
      versions: g.versions.sort(
        (a, b) => Date.parse(b.date_published) - Date.parse(a.date_published),
      ),
    }));
}
