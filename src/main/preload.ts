import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherBridge, TaskSnapshot } from '../shared/types';
// Sandboxed preload is a single CommonJS file; shared types are erased at build time.
const launcher: LauncherBridge = {
  invoke: (command, payload) => ipcRenderer.invoke('launcher:invoke', command, payload),
  onLaunch: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: import("../shared/types").LaunchState) => callback(state);
    ipcRenderer.on("launcher:launch",listener);
    return ()=>ipcRenderer.removeListener("launcher:launch",listener);
  },
  onTask: callback => {
    if (typeof callback !== 'function') throw new TypeError('必须提供任务回调');
    const listener = (_event: Electron.IpcRendererEvent, task: TaskSnapshot) => callback(task);
    ipcRenderer.on('launcher:task', listener);
    return () => ipcRenderer.removeListener('launcher:task', listener);
  },
  onNotice: callback => {
    if (typeof callback !== 'function') throw new TypeError('必须提供通知回调');
    const listener = (_event: Electron.IpcRendererEvent, notice: import("../shared/types").LauncherNotice) => callback(notice);
    ipcRenderer.on('launcher:notice', listener);
    return () => ipcRenderer.removeListener('launcher:notice', listener);
  },
};
contextBridge.exposeInMainWorld('launcher', Object.freeze(launcher));
