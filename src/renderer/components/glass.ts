import type { Settings } from "../../shared/types";
import "../customization.css";
import { applyLiveBackground } from "./live-background";
const wallpapers: Record<string, string> = {
  "builtin:sakura-night": "wallpapers/sakura-night",
  "builtin:cloud-dawn": "wallpapers/cloud-dawn",
  "builtin:voxel-twilight": "wallpapers/voxel-twilight",
  "builtin:voxel-dawn": "wallpapers/voxel-dawn",
  "builtin:moon-lake": "moonlake",
  "builtin:aurora": "aurora",
  "builtin:garden": "garden",
  "builtin:dunes": "dunes",
  "builtin:bloom-light": "bloom-light",
  "builtin:bloom-dark": "bloom-dark",
};
export function applySettings(s: Settings) {
  const reduced =
    s.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  root.dataset.theme =
    s.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : s.theme;
  root.dataset.density = s.density;
  root.dataset.motion = reduced ? "reduced" : "full";
  root.dataset.labels = String(s.navigationLabels);
  root.dataset.customization = "ready";
  root.dataset.background = s.backgroundStyle;
  root.dataset.glass = s.glassStyle;
  root.dataset.transition = reduced ? "none" : s.pageTransition;
  root.dataset.notificationPosition = s.notificationPosition;
  root.dataset.homeIntro = String(s.showHomeIntro);
  root.dataset.libraryView = s.libraryView;
  const url = wallpapers[s.wallpaper]
    ? `./assets/${wallpapers[s.wallpaper]}.png`
    : /^zhumeng-wallpaper:\/\/local\/[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(
          s.wallpaper,
        )
      ? s.wallpaper
      : "./assets/moonlake.png";
  const vars: Record<string, string> = {
    "--wallpaper": `url("${new URL(url, location.href).href}")`,
    "--wall-brightness": String(s.wallpaperBrightness),
    "--wall-blur": `${s.wallpaperBlur}px`,
    "--wall-fit": s.wallpaperFit === "stretch" ? "100% 100%" : s.wallpaperFit,
    "--glass-opacity": String(s.glassOpacity),
    "--glass-blur": `${s.glassBlur}px`,
    "--refraction": String(s.glassRefraction),
    "--accent": s.accentColor,
    "--radius": `${s.cornerRadius}px`,
    "--duration": `${reduced ? 0 : 260 / s.animationSpeed}ms`,
    "--background-color": s.backgroundColor,
    "--gradient-color": s.gradientColor,
    "--background-overlay": String(s.backgroundOverlay),
    "--background-vignette": String(s.backgroundVignette),
    "--wall-saturation": String(s.wallpaperSaturation),
    "--wall-position": `${s.wallpaperPositionX}% ${s.wallpaperPositionY}%`,
    "--wall-scale": String(s.wallpaperScale),
    "--glass-border": String(s.glassBorderOpacity),
    "--glass-shadow": String(s.glassShadow),
    "--font-scale": String(s.fontScale),
    "--custom-font": s.fontFamily === "yahei" ? '"Microsoft YaHei UI", sans-serif' : s.fontFamily === "segoe" ? '"Segoe UI", "Microsoft YaHei", sans-serif' : 'system-ui, "Microsoft YaHei", sans-serif',
    "--nav-width": `${s.navWidth}px`,
    "--content-width": `${s.contentWidth}px`,
    "--card-spacing": `${s.cardSpacing}px`,
    "--home-title-size": `${s.homeTitleSize}px`,
    "--home-text-align": s.homeTextAlign,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applyLiveBackground(s, new URL(url, location.href).href);
  document
    .querySelector("#glass-displacement feDisplacementMap")
    ?.setAttribute("scale", String(56 * s.glassRefraction));
  document.body.classList.toggle("no-parallax", !s.parallax || reduced);
  document.body.classList.toggle("no-particles", !s.particles);
  const title = document.querySelector(".home-intro h1");
  const subtitle = document.querySelector(".home-caption");
  if (title) title.textContent = s.homeTitle;
  if (subtitle) subtitle.textContent = s.homeSubtitle;
}
export function installGlass() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const defs = document.createElementNS(ns, "defs");
  const filter = document.createElementNS(ns, "filter");
  filter.id = "glass-displacement";
  const turbulence = document.createElementNS(ns, "feTurbulence");
  turbulence.setAttribute("type", "fractalNoise");
  turbulence.setAttribute("baseFrequency", ".014 .025");
  turbulence.setAttribute("numOctaves", "2");
  turbulence.setAttribute("seed", "8");
  turbulence.setAttribute("result", "noise");
  const displacement = document.createElementNS(ns, "feDisplacementMap");
  displacement.setAttribute("in", "SourceGraphic");
  displacement.setAttribute("in2", "noise");
  displacement.setAttribute(
    "scale",
    String(
      56 *
        Number(
          document.documentElement.style.getPropertyValue("--refraction") ||
            0.35,
        ),
    ),
  );
  displacement.setAttribute("xChannelSelector", "R");
  displacement.setAttribute("yChannelSelector", "G");
  filter.append(turbulence, displacement);
  defs.append(filter);
  svg.append(defs);
  document.body.append(svg);
  document.addEventListener("pointermove", (event) => {
    if (document.body.classList.contains("no-parallax")) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(".glass");
    if (target) {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    }
  });
}
