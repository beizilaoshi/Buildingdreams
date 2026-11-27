import type { Settings } from "../../shared/types";
import { api, e, button } from "../ui";
let cancelOpening: (() => void) | undefined;
/** Show the separate native logo splash, then reveal the ready app window from the center. */
export async function revealStartupWindow(settings: Settings): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  const animate = settings.openingEnabled && !settings.reducedMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const surfaces = [app, document.querySelector<HTMLElement>("#wallpaper"), document.querySelector<HTMLElement>("#toasts")].filter((node): node is HTMLElement => !!node);
  const prior = surfaces.map(node => ({ node, clip: node.style.getPropertyValue("clip-path"), priority: node.style.getPropertyPriority("clip-path") }));
  const wasInert = app?.inert ?? false;
  const hadOpeningClass = document.documentElement.classList.contains("opening-active");
  const speed = Math.max(.0625, Math.min(16, settings.openingSpeed * settings.animationSpeed || 1));
  if (animate && app) {
    document.documentElement.classList.add("opening-active");
    surfaces.forEach(surface => surface.style.setProperty("clip-path", "inset(0 50% 0 50%)"));
    app.inert = true;
  }
  try {
    await api("window.ready", animate);
    document.documentElement.classList.remove("booting");
    if (!animate) return;
    const frames = surfaces.map(surface => surface.animate(
      [{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0% 0 0%)" }],
      { duration: 600 / speed, fill: "forwards", easing: "cubic-bezier(.22,.61,.36,1)" },
    ));
    await Promise.all(frames.map(frame => frame.finished.catch(() => undefined)));
  } finally {
    prior.forEach(({ node, clip, priority }) => clip ? node.style.setProperty("clip-path", clip, priority) : node.style.removeProperty("clip-path"));
    if (app) app.inert = wasInert;
    if (!hadOpeningClass) document.documentElement.classList.remove("opening-active");
  }
}
/** One owner for startup and previews; every exit restores the exact prior state. */
export async function playOpening(settings: Settings): Promise<void> {
  cancelOpening?.();
  if (!settings.openingEnabled || settings.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  const surfaces = [app, document.querySelector<HTMLElement>("#wallpaper"), document.querySelector<HTMLElement>("#toasts")].filter((node): node is HTMLElement => !!node);
  const prior = surfaces.map(node => ({ node, clip: node.style.getPropertyValue('clip-path'), priority: node.style.getPropertyPriority('clip-path') }));
  const wasInert = app.inert;
  const hadOpeningClass = document.documentElement.classList.contains("opening-active");
  document.documentElement.classList.add("opening-active");
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const speed = Math.max(.0625, Math.min(16, settings.openingSpeed * settings.animationSpeed || 1));
  const hold = 1250 / speed, logoOut = 220 / speed, reveal = 1150 / speed;
  await new Promise<void>(resolve => {
    const node = e('div', `opening ${settings.openingTheme}`);
    node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', '筑梦开场');
    const identity = e('div', 'opening-identity');
    const mark = document.createElement('img'); mark.src = './assets/logos/zhumeng-mengmiao.png'; mark.alt = '筑梦标识';
    identity.append(mark);
    const animations: Animation[] = [];
    let timer: ReturnType<typeof setTimeout>;
    let finished = false;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const end = () => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      animations.forEach(animation => animation.cancel());
      prior.forEach(({ node, clip, priority }) => clip ? node.style.setProperty('clip-path', clip, priority) : node.style.removeProperty('clip-path'));
      app.inert = wasInert;
      if (!hadOpeningClass) document.documentElement.classList.remove("opening-active");
      node.remove(); document.removeEventListener('keydown', key); media.removeEventListener('change', motion);
      if (cancelOpening === end) cancelOpening = undefined;
      if (focus?.isConnected && !focus.closest('[inert]')) focus.focus({ preventScroll: true });
      resolve();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); end(); } };
    const motion = () => { if (media.matches) end(); };
    cancelOpening = end;
    node.append(identity, button('跳过开场 · Esc', end, 'opening-skip'));
    node.addEventListener('click', end);
    surfaces.forEach(surface => surface.style.setProperty('clip-path', 'inset(0 50% 0 50%)'));
    app.inert = true; document.body.append(node);
    node.querySelector('button')!.focus();
    document.addEventListener('keydown', key); media.addEventListener('change', motion);
    animations.push(identity.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600 / speed, fill: 'both', easing: 'ease-out' }));
    timer = setTimeout(() => {
      node.classList.add('revealing');
      animations.push(identity.animate(
        [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.82)', filter: 'blur(5px)' }],
        { duration: logoOut, fill: 'forwards', easing: 'ease-in' },
      ));
      timer = setTimeout(() => {
        for (const surface of surfaces) animations.push(surface.animate([{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0% 0 0%)' }], { duration: reveal, fill: 'forwards', easing: 'cubic-bezier(.22,.61,.36,1)' }));
        // Keep the plain-color cover while the logo fades, then reveal the real UI from the center.
        timer = setTimeout(end, reveal);
      }, logoOut);
    }, hold);
  });
}
