import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "筑梦 空格"));
  await mkdir(join(root, "versions", "base"), { recursive: true });
  await writeFile(
    join(root, "versions", "base", "base.json"),
    JSON.stringify({
      id: "base",
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "net.minecraft.Main",
      minecraftArguments:
        "--username ${auth_player_name} --accessToken ${auth_access_token} --gameDir ${game_directory}",
      libraries: [],
      javaVersion: { component: "java-runtime", majorVersion: 17 },
    }),
  );
  return root;
}
