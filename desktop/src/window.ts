import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { platformChrome } from './window-chrome.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dashboardWindow: BrowserWindow | null = null;

export function getDashboardWindow(): BrowserWindow | null {
  return dashboardWindow;
}

// The session token must NOT ride in argv (visible to every local user via
// ps): stage it in a 0600 userData file the preload reads and deletes before
// any page script runs (no login flash, no reload). Only the file PATH
// travels in argv, which leaks nothing. Null when staging fails — the window
// still opens and the dashboard fetches a fresh session over IPC instead.
function stageSessionToken(token: string): string | null {
  const file = path.join(app.getPath('userData'), 'session-token');
  try {
    // Unlink first: writeFileSync's mode only applies to newly created
    // files, so overwriting a stale file would inherit its permissions.
    try { fs.unlinkSync(file); } catch { /* no stale file */ }
    fs.writeFileSync(file, token, { mode: 0o600 });
    return file;
  } catch (err) {
    console.warn('[desktop] could not stage the dashboard session token:', err);
    return null;
  }
}

// One window at a time, destroyed on close — the app lives in the tray, the
// window is an on-demand view.
export function openDashboard(port: number, token: string): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }

  const tokenFile = stageSessionToken(token);
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'OmniPix',
    ...platformChrome(process.platform),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // The dashboard has no other way to know which build is running: the
      // server's own package version is not the released app version (#703).
      // The version is public, so argv is fine for it; the token travels by
      // file (see stageSessionToken), omitted entirely when staging failed.
      additionalArguments: [
        ...(tokenFile ? [`--omnipix-token-file=${tokenFile}`] : []),
        `--omnipix-version=${app.getVersion()}`,
      ],
    },
  });

  dashboardWindow.loadURL(`http://127.0.0.1:${port}`);
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    // Best-effort cleanup so a valid token never rests on disk past the
    // window's lifetime (the preload normally deletes it at startup).
    if (tokenFile) {
      try { fs.unlinkSync(tokenFile); } catch { /* already gone */ }
    }
  });
}
