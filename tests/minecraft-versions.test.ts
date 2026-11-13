import { describe, it, expect } from "vitest";
import {
  minecraftGroup,
  sortMinecraftVersions,
} from "../src/shared/minecraft-versions";
describe("source-derived Minecraft catalogue", () => {
  it("classifies PCL historical, corrected and April Fools entries without renaming install IDs", () => {
    expect(minecraftGroup({ id: "20w14infinite", type: "snapshot" })).toBe(
      "fool",
    );
    expect(
      minecraftGroup({
        id: "future",
        type: "snapshot",
        releaseTime: "2028-03-31T23:00:00Z",
      }),
    ).toBe("fool");
    expect(minecraftGroup({ id: "1.8", type: "snapshot" })).toBe("release");
    expect(minecraftGroup({ id: "1.8-pre1", type: "snapshot" })).toBe(
      "snapshot",
    );
    expect(minecraftGroup({ id: "a1.2", type: "old_alpha" })).toBe("ancient");
  });
  it("sorts by actual release date, preserves unknown dates without inventing them", () => {
    expect(
      sortMinecraftVersions([
        { id: "1.9", releaseTime: "2020-01-01T00:00:00Z" },
        { id: "1.21", releaseTime: "2024-01-01T00:00:00Z" },
        { id: "unknown" },
      ]).map((x) => x.id),
    ).toEqual(["1.21", "1.9", "unknown"]);
  });
});
