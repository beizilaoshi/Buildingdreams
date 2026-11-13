import { api, state, notify } from '../ui';
import type { LaunchState } from '../../shared/types';
import { SnakeField } from './launch-snake-engine';
import './launch-snake.css';
let active: { dispose: () => void } | undefined;
export const launchSnakeBusy = () => !!active;
export function beginLaunchSnake(instanceId: string): { reject: () => Promise<void> } {
  if (active) throw new Error('已有游戏正在启动');
  let newest = Date.now(), disposed = false, cancelling = false, cancelIntent = false, startRejected = false, eventRevision = 0;
  const previousFocus = document.activeElement as HTMLElement | null;
  const modal = document.createElement('dialog'); modal.className = 'launch-snake'; modal.setAttribute('aria-label', '正在启动游戏');
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '点击投放像素食物');
  const hud = document.createElement('section'); hud.className = 'launch-snake-hud';
  const brand = document.createElement('p'); brand.className = 'launch-snake-brand'; brand.textContent = '筑梦 · ZHUMENG';
  const heading = document.createElement('h1'); heading.textContent = '正在启动游戏';
  const name = document.createElement('p'); name.className = 'launch-snake-instance'; name.textContent = state.instances.find(i => i.id === instanceId)?.name ?? '我的世界';
  const hint = document.createElement('p'); hint.className = 'launch-snake-hint'; hint.textContent = '正在准备游戏 · 点击任意空白处，喂它一颗星'; hint.setAttribute('role', 'status');
  const cancel = document.createElement('button'); cancel.className = 'launch-snake-cancel'; cancel.textContent = '取消启动';
  hud.append(brand, heading, name, hint, cancel); modal.append(canvas, hud);
  const field = new SnakeField(80, 50), context = canvas.getContext('2d')!;
  let width = 0, height = 0, raf = 0, last = 0, elapsed = 0;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const draw = () => {
    context.clearRect(0, 0, width, height); const sx = width / field.cols, sy = height / field.rows;
    context.fillStyle = '#ead1ff'; for (const p of field.food) context.fillRect(p.x * sx + 5, p.y * sy + 5, 7, 7);
    field.body.forEach((p, i) => { context.fillStyle = i === 0 ? '#ece7ff' : `rgba(163,151,244,${1 - i / 42})`; context.fillRect(p.x * sx + 2, p.y * sy + 2, sx - 3, sy - 3); });
    const head = field.body[0]; context.fillStyle = '#24203e'; context.fillRect(head.x * sx + sx - 6, head.y * sy + 4, 2, 2);
  };
  const resize = () => { width = innerWidth; height = innerHeight; const dpr = Math.min(2, devicePixelRatio || 1); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); context.setTransform(dpr, 0, 0, dpr, 0, 0); field.resize(Math.max(1, Math.floor(width / 18)), Math.max(1, Math.floor(height / 18))); draw(); };
  const frame = (now: number) => {
    if (disposed) return;
    const speed = Math.max(.25, Math.min(4, state.settings?.animationSpeed || 1));
    const interval = media.matches || state.settings?.reducedMotion ? 280 : 85 / speed;
    if (!document.hidden) { elapsed += Math.min(150, now - (last || now)); if (elapsed >= interval) { field.step(); elapsed = 0; draw(); } }
    last = now; raf = requestAnimationFrame(frame);
  };
  const feed = (event: MouseEvent) => { if ((event.target as HTMLElement).closest('button')) return; field.feed(event.clientX / width * field.cols, event.clientY / height * field.rows); field.step(); draw(); canvas.dataset.feeds = String(Number(canvas.dataset.feeds ?? 0) + 1); };
  const dispose = () => { if (disposed) return; disposed = true; unsubscribe(); cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('pagehide', dispose); modal.close(); modal.remove(); if (active?.dispose === dispose) active = undefined; if (previousFocus?.isConnected) previousFocus.focus(); };
  const update = (value: LaunchState) => { if (disposed || value.instanceId !== instanceId || value.time < newest) return; newest = value.time; eventRevision++;
    if ((!cancelIntent && value.phase === 'running' && (value.windowReady === true || value.gameReady === true) && !!value.pid && value.pid > 0) || ['failed', 'cancelled', 'exited'].includes(value.phase)) dispose();
    else if (value.phase === 'stopping') { cancelling = true; cancel.disabled = true; hint.textContent = '正在取消启动，请稍候…'; }
  };
  const unsubscribe = window.launcher.onLaunch(update);
  const retryCancel = () => { cancelling = false; cancel.disabled = false; hint.textContent = '尚未完成取消，请重试'; };
  const verifyRejectedStart = async () => {
    const version = eventRevision;
    try {
      const value = await api('launch.status', instanceId);
      if (disposed || version !== eventRevision) return;
      // Rejected start plus authoritative idle means no owned attempt remains.
      if (value.phase === 'idle') { dispose(); return; }
      update(value);
      if (!disposed && value.phase !== 'stopping') retryCancel();
    } catch (error) { if (!disposed) { retryCancel(); notify(error); } }
  };
  const requestCancel = async () => { if (cancelling || disposed) return; cancelIntent = true; cancelling = true; cancel.disabled = true; hint.textContent = '正在取消启动，请稍候…';
    try {
      // stop also aborts preparation, and covers the child-created/pre-running window.
      const value = await api('launch.stop', instanceId); update(value);
      if (!disposed && value.phase !== 'stopping') {
        retryCancel();
        if (startRejected) await verifyRejectedStart();
      }
    } catch (error) { if (!disposed) { cancelling = false; cancel.disabled = false; hint.textContent = '暂时无法取消，请重试'; notify(error); } }
  };
  cancel.addEventListener('click', () => void requestCancel());
  modal.addEventListener('cancel', event => { event.preventDefault(); void requestCancel(); });
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void requestCancel(); }
    if (event.key === 'Tab') { event.preventDefault(); cancel.focus(); } });
  modal.addEventListener('click', feed);
  active = { dispose }; document.body.append(modal); modal.showModal(); cancel.focus();
  window.addEventListener('resize', resize); window.addEventListener('pagehide', dispose); resize(); raf = requestAnimationFrame(frame);
  return { reject: async () => {
    if (disposed) return;
    startRejected = true;
    if (!cancelIntent) dispose();
    else await verifyRejectedStart();
  } };
}
