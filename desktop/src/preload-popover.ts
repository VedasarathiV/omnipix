// Built to build/preload-popover.cjs. Exposes the minimal IPC surface the
// popover UI needs — no Node access in the renderer.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('omnipix', {
  snapshot: () => ipcRenderer.invoke('omnipix:snapshot'),
  openDashboard: () => ipcRenderer.invoke('omnipix:open-dashboard'),
  copyBaseUrl: (kind: 'openai' | 'anthropic') => ipcRenderer.invoke('omnipix:copy-base-url', kind),
  copyApiKey: () => ipcRenderer.invoke('omnipix:copy-api-key'),
  setLoginItem: (open: boolean) => ipcRenderer.invoke('omnipix:set-login-item', open),
  quit: () => ipcRenderer.invoke('omnipix:quit'),
  onRefresh: (cb: () => void) => {
    ipcRenderer.on('omnipix:refresh', cb);
    return () => { ipcRenderer.removeListener('omnipix:refresh', cb); };
  },
});
