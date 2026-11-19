const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'OmniPix Studio',
    backgroundColor: '#0b0b0d',
    webPreferences: { sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'dist-ui/index.html'));
  win.webContents.on('will-navigate', (event, url) => {
    // Single-page app: keep hash routing in-window, open the rest outside.
    if (!url.startsWith('file://')) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
