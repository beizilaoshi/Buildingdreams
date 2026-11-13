import { api, account, e } from "../ui";
import type { AccountSummary } from "../../shared/types";

function defaultHead(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const pixels = ["00000000", "00000000", "01111110", "11211211", "11311311", "11144111", "11444411", "11144111"];
  const colors = ["#493025", "#ba8968", "#f4f0df", "#5b68b1", "#704535"];
  pixels.forEach((row, y) => [...row].forEach((color, x) => { ctx.fillStyle = colors[Number(color)]; ctx.fillRect(x, y, 1, 1); }));
}
/** Minecraft's head UVs, with legacy opaque unused hat pixels suppressed. */
export function drawSkinHead(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 8, 8);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
  if (image.naturalHeight === 32) {
    const probe = document.createElement("canvas");
    probe.width = 32; probe.height = 32;
    const p = probe.getContext("2d")!;
    p.drawImage(image, 32, 0, 32, 32, 0, 0, 32, 32);
    const rgba = p.getImageData(0, 0, 32, 32).data;
    if (rgba.every((v, i) => i % 4 !== 3 || v >= 128)) return;
  }
  ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
}
export function avatar(identity: AccountSummary | undefined) {
  const node = e("div", "player-avatar");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 8;
  canvas.className = "avatar-head";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", identity ? `${identity.name} 的默认头像` : "默认玩家头像");
  defaultHead(canvas);
  const status = e("p", "muted avatar-status", identity?.kind === "microsoft" ? "获取皮肤中" : "默认头像");
  node.append(canvas, status);
  const current = () => node.isConnected && account()?.id === identity?.id;
  if (identity?.kind === "microsoft") {
    void api("accounts.appearance", identity.id).then(async (result) => {
      if (!current() || result.accountId !== identity.id) return;
      if (result.source === "official") {
        const image = new Image();
        image.src = result.png;
        await image.decode();
        if (!current()) return;
        drawSkinHead(canvas, image);
        canvas.setAttribute("aria-label", `${identity.name} 的 Minecraft 皮肤头像`);
        status.textContent = "正版皮肤";
      } else status.textContent = result.reason === "unavailable" ? "皮肤暂不可用 · 默认头像" : "未提供皮肤 · 默认头像";
    }).catch(() => { if (current()) status.textContent = "皮肤暂不可用 · 默认头像"; });
  }
  return node;
}
