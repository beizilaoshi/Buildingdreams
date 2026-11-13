import type { Settings } from "../../shared/types";
import { e, button } from "../ui";
let cancelOpening: (() => void) | undefined;
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
  const hold = 1250 / speed, reveal = 1150 / speed;
  await new Promise<void>(resolve => {
    const node = e('div', `opening ${settings.openingTheme}`);
    node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', '筑梦开场');
    const identity = e('div', 'opening-identity');
    const mark = document.createElement('img'); mark.src = './assets/logos/zhumeng-generated.png'; mark.alt = '筑梦标识';
    identity.append(mark, e('h1', '', '筑梦'), e('p', 'eyebrow', 'ZHUMENG'));
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
      identity.style.visibility = 'hidden';
      for (const surface of surfaces) animations.push(surface.animate([{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0% 0 0%)' }], { duration: reveal, fill: 'forwards', easing: 'cubic-bezier(.22,.61,.36,1)' }));
      // The overlay is transparent during reveal; the actual UI and wallpaper are clipped.
      timer = setTimeout(end, reveal);
    }, hold);
  });
}
