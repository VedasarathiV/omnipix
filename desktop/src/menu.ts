import { app, BrowserWindow, Menu, shell } from 'electron';

// Native application menu (File/Edit/View/...). Navigation items send a
// one-way 'omnipix:navigate' message; the preload exposes a receive-only
// listener, so the renderer gains no new capabilities.
// Mirrors studio IconRail order + shortcuts exactly (⌘1..⌘9, ⌘0 for voice);
// the renderer validates ids, so unknown rails are ignored, never crash.
const RAILS: Array<{ id: string; label: string; accelerator?: string }> = [
  { id: 'chat', label: 'Chat', accelerator: 'CmdOrCtrl+1' },
  { id: 'agents', label: 'Agents', accelerator: 'CmdOrCtrl+2' },
  { id: 'skills', label: 'Skills', accelerator: 'CmdOrCtrl+3' },
  { id: 'keys', label: 'Provider Keys', accelerator: 'CmdOrCtrl+4' },
  { id: 'models', label: 'Models', accelerator: 'CmdOrCtrl+5' },
  { id: 'evals', label: 'Evals', accelerator: 'CmdOrCtrl+6' },
  { id: 'search', label: 'Search', accelerator: 'CmdOrCtrl+7' },
  { id: 'docs', label: 'Docs', accelerator: 'CmdOrCtrl+8' },
  { id: 'notifications', label: 'Notifications', accelerator: 'CmdOrCtrl+9' },
  { id: 'voice', label: 'Voice', accelerator: 'CmdOrCtrl+0' },
];

const DOCS_URL = 'https://github.com/VedasarathiV/omnipix';

// Electron 38 hands menu clicks a BaseWindow, which has no webContents —
// narrow to BrowserWindow and fall back to the dashboard window.
function asBrowserWindow(w: Electron.BaseWindow | null | undefined, fallback: () => BrowserWindow | null): BrowserWindow | null {
  return w instanceof BrowserWindow ? w : fallback();
}

function navigate(win: BrowserWindow | null, rail: string): void {
  win?.webContents.send('omnipix:navigate', rail);
}

export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: (_i: unknown, w?: Electron.BaseWindow) => asBrowserWindow(w ?? null, getWindow)?.webContents.send('omnipix:open-settings'),
          },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: (_i: unknown, w?: Electron.BaseWindow) => asBrowserWindow(w ?? null, getWindow)?.webContents.send('omnipix:new-chat'),
        },
        { type: 'separator' as const },
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...RAILS.map(r => ({
          label: `Go to ${r.label}`,
          accelerator: r.accelerator,
          click: (_i: unknown, w?: Electron.BaseWindow) => navigate(asBrowserWindow(w ?? null, getWindow), r.id),
        })),
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' as const }, { role: 'zoom' as const }, { role: 'front' as const }] },
    {
      label: 'Help',
      submenu: [
        { label: 'OmniPix Repository', click: () => void shell.openExternal(DOCS_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${DOCS_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
