const { app } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
// Electron logs rejected IPC handlers even when the renderer catches them.
// These two deliberate negative probes remain asserted below; keep unexpected errors visible.
const reportError = console.error;
console.error = (...args) => {
  if (String(args[0]).startsWith("Error occurred in handler for 'launcher:invoke'") &&
      /配置超出范围: glassOpacity|未知命令/.test(String(args[1]))) return;
  reportError(...args);
};
const data = mkdtempSync(join(tmpdir(), 'zhumeng-shell-'));
app.setPath('userData', data);
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 15000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Node leaked');
        if (typeof window.launcher?.onTask !== 'function') throw new Error('Bridge absent');
        const unsubscribe = window.launcher.onTask(() => {}); unsubscribe();
        await window.launcher.invoke('settings.patch', { reducedMotion: true });
        const settings = await window.launcher.invoke('settings.read', undefined);
        if (!settings.reducedMotion) throw new Error('Settings round trip failed');
        for (const [command, payload] of [['settings.patch', { glassOpacity: 5 }], ['unknown.command', undefined]]) {
          let rejected = false; try { await window.launcher.invoke(command, payload); } catch { rejected = true; }
          if (!rejected) throw new Error('Unsafe command accepted');
        }
        return { bridge: true, nodeIsolated: true, persistence: true, validation: true };
      })()`);
      console.log('DESKTOP_SMOKE_PASS', JSON.stringify(result));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../dist/main/index.js');
