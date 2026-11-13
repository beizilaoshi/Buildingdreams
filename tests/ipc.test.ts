import { expect, test } from 'vitest';
import { assertTrustedSender, CommandRouter } from '../src/main/ipc';
const url = 'file:///C:/app/renderer/index.html';
test('rejects subframes, other windows and non-application pages', () => {
  const frame = { url };
  expect(() => assertTrustedSender({ sender: { id: 2, mainFrame: frame }, senderFrame: frame }, 1, url)).toThrow();
  expect(() => assertTrustedSender({ sender: { id: 1, mainFrame: frame }, senderFrame: { url } }, 1, url)).toThrow();
  const remote = { url: 'https://evil.example/' };
  expect(() => assertTrustedSender({ sender: { id: 1, mainFrame: remote }, senderFrame: remote }, 1, url)).toThrow();
  expect(() => assertTrustedSender({ sender: { id: 1, mainFrame: frame }, senderFrame: frame }, 1, url)).not.toThrow();
});
test('rejects unknown commands and malformed or oversized payloads before executing', async () => {
  const router = new CommandRouter();
  let called = false;
  router.register('settings.patch', value => { if (!value || typeof value !== 'object' || (value as any).glassOpacity > 1) throw new Error('invalid'); return value as any; }, async () => { called = true; return {} as any; });
  await expect(router.invoke('constructor', {})).rejects.toThrow();
  await expect(router.invoke('settings.patch', { glassOpacity: 5 })).rejects.toThrow();
  await expect(router.invoke('settings.patch', { value: 'x'.repeat(70000) })).rejects.toThrow();
  expect(called).toBe(false);
  await router.invoke('settings.patch', { glassOpacity: 0.5 });
  expect(called).toBe(true);
});
