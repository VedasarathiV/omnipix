// Built to build/preload.cjs (CommonJS — the reliable preload format).
// Runs in the renderer before any page script: seeds the dashboard session
// token into localStorage so AuthGate's very first /api/auth/status call is
// authenticated. The token arrives as a 0600 userData file whose PATH is in
// additionalArguments (never the token itself — argv is world-readable via
// ps); read it synchronously to preserve seed-before-first-paint ordering,
// then delete it so the secret never rests on disk past startup.
import { contextBridge, ipcRenderer } from 'electron';
import fs from 'node:fs';

const TOKEN_KEY = 'omnipix_dashboard_token';
const arg = process.argv.find((a) => a.startsWith('--omnipix-token-file='));
if (arg) {
  const file = arg.slice('--omnipix-token-file='.length);
  try {
    const token = fs.readFileSync(file, 'utf8').trim();
    // Seed BEFORE deleting: a setItem throw must not destroy a valid token.
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone — harmless (the main process also unlinks on close).
    }
  } catch (err) {
    // Token file missing/unreadable or localStorage unavailable — the
    // dashboard shows its login screen (or fetches a fresh session via
    // __OMNIPIX_SESSION__). Warn so a persistently broken handoff is visible
    // in the log instead of failing silently every launch.
    console.warn('[desktop] dashboard session handoff failed:', err instanceof Error ? err.message : err);
  }
}

// Lets the client adapt its chrome (drag region, traffic-light padding,
// no Sign out) when running inside the desktop shell.
contextBridge.exposeInMainWorld('__OMNIPIX_DESKTOP__', true);
contextBridge.exposeInMainWorld('__OMNIPIX_PLATFORM__', process.platform);

// The dashboard window signs in as the hidden machine account, whose password
// is random and never shown, so it must never land on the login form. When the
// seeded session is gone (expired after 30 days of uptime, or cleared by a 401)
// AuthGate asks the main process for a fresh one instead. Exposed as a bare
// function rather than a broader bridge: the renderer loads http://127.0.0.1,
// and every extra capability handed to that world is one an XSS could use —
// this one only ever hands back a session for the account the window already
// runs as.
contextBridge.exposeInMainWorld('__OMNIPIX_SESSION__', () => ipcRenderer.invoke('omnipix:session-token'));

// Push-to-talk dictation: the global hotkey (main process) toggles recording
// in the dashboard; the renderer reports which accelerator actually stuck so
// the UI can name it.
contextBridge.exposeInMainWorld('__OMNIPIX_DICTATION__', {
  hotkey: () => ipcRenderer.invoke('omnipix:dictation-hotkey'),
  onToggle: (cb: () => void) => {
    ipcRenderer.on('omnipix:dictation-toggle', cb);
    return () => { ipcRenderer.removeListener('omnipix:dictation-toggle', cb); };
  },
});

// "Start on system startup" for the dashboard's Settings dialog. Mirrors the
// popover's login-item toggle, but as a narrow get/set pair the dashboard can
// call. Reads the OS-level "open at login" flag so the switch reflects reality
// (and stays in sync with the popover's own toggle). Electron's login items
// only work on macOS and Windows; on Linux setLoginItemSettings is a no-op, so
// the bridge is not exposed there and the dashboard hides the switch.
if (process.platform === 'darwin' || process.platform === 'win32') {
  contextBridge.exposeInMainWorld('__OMNIPIX_LOGIN_ITEM__', {
    get: () => ipcRenderer.invoke('omnipix:get-login-item'),
    set: (open: boolean) => ipcRenderer.invoke('omnipix:set-login-item', open),
  });
}

// The running build's version, so the dashboard can show which one it is and
// offer a check against the published releases (#703). Arrives the same way the
// token does; absent in a browser, where the dashboard simply omits the row
// rather than guessing from the server's own (unrelated) package version.
const versionArg = process.argv.find((a) => a.startsWith('--omnipix-version='));
contextBridge.exposeInMainWorld(
  '__OMNIPIX_VERSION__',
  versionArg ? versionArg.slice('--omnipix-version='.length) : null,
);

// Native menu actions (View > Go to …, File > New Chat, Settings). Strictly
// receive-only: the main process pushes UI intents, the renderer subscribes.
contextBridge.exposeInMainWorld('__OMNIPIX_MENU__', {
  onAction: (cb: (action: { kind: 'navigate'; rail: string } | { kind: 'new-chat' } | { kind: 'open-settings' }) => void) => {
    const nav = (_e: unknown, rail: string) => cb({ kind: 'navigate', rail });
    const fresh = () => cb({ kind: 'new-chat' });
    const prefs = () => cb({ kind: 'open-settings' });
    ipcRenderer.on('omnipix:navigate', nav);
    ipcRenderer.on('omnipix:new-chat', fresh);
    ipcRenderer.on('omnipix:open-settings', prefs);
    return () => {
      ipcRenderer.removeListener('omnipix:navigate', nav);
      ipcRenderer.removeListener('omnipix:new-chat', fresh);
      ipcRenderer.removeListener('omnipix:open-settings', prefs);
    };
  },
});

// The in-app updater (the Settings update dialog and the update reminder). Like the session bridge above, deliberately
// narrow: it can only check for, download and install the release published at
// the configured feed — the feed URL and signature checks live in the main
// process and nothing here can point them anywhere else.
contextBridge.exposeInMainWorld('__OMNIPIX_UPDATER__', {
  state: () => ipcRenderer.invoke('omnipix:update-state'),
  check: () => ipcRenderer.invoke('omnipix:update-check'),
  download: () => ipcRenderer.invoke('omnipix:update-download'),
  install: () => ipcRenderer.invoke('omnipix:update-install'),
  subscribe: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state);
    ipcRenderer.on('omnipix:update-state', handler);
    return () => { ipcRenderer.removeListener('omnipix:update-state', handler); };
  },
});

// `desktop` class on <html> identifies the desktop shell. On macOS, `desktop-mac`
// activates the translucent glass backdrop that pairs with native vibrancy;
// on Windows and Linux, the solid theme background is preserved so contrast and
// readability remain intact.
function applyDesktopClass() {
  document.documentElement?.classList.add('desktop');
  if (process.platform === 'darwin') {
    document.documentElement?.classList.add('desktop-mac');
  }
}
try {
  applyDesktopClass();
} catch {
  // Document not ready — DOMContentLoaded below covers it.
}

// Mirror the dashboard's theme to the main process so the tray popover
// matches. The dashboard expresses its resolved theme as the `dark` class
// and the underlying choice (dark/light/system) as `data-theme-choice`,
// both on documentElement — observe those rather than reaching across
// worlds into localStorage. The choice lets the main process hand
// nativeTheme.themeSource back to the OS when the user picks System.
function reportTheme() {
  ipcRenderer.send('omnipix:theme-changed', {
    resolved: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    choice: document.documentElement.dataset.themeChoice,
  });
}

// Mirror the dashboard's locale to the main process so the native tray menu and
// the popover match. The I18nProvider sets `<html lang>` on every locale change,
// so observe that attribute rather than reaching into the dashboard's
// localStorage from this preload world.
function reportLocale() {
  const lang = document.documentElement.lang;
  if (lang) ipcRenderer.send('omnipix:locale-changed', lang);
}
window.addEventListener('DOMContentLoaded', () => {
  applyDesktopClass();
  reportTheme();
  reportLocale();
  new MutationObserver(() => {
    reportTheme();
    reportLocale();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'lang', 'data-theme-choice'],
  });
});
