// Electron shell: loads the built client (file://) or a dev server URL.
// Optionally spawns the Python backend for saves/leaderboards when
// GTA_SPAWN_SERVER=1 and a python interpreter is available.

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

let serverProc = null;

function trySpawnServer() {
  if (process.env.GTA_SPAWN_SERVER !== '1') return;
  const serverDir = path.join(__dirname, '..', 'server');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  try {
    serverProc = spawn(python, ['-m', 'uvicorn', 'main:app', '--port', '8177'], {
      cwd: serverDir,
      stdio: 'ignore',
      detached: false,
    });
    serverProc.on('error', () => { serverProc = null; });
  } catch (e) {
    serverProc = null; // game falls back to localStorage saves
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0a0c10',
    autoHideMenuBar: true,
    title: 'Grand Theft Audi — Neustadt Bay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.GTA_DEV_URL) {
    win.loadURL(process.env.GTA_DEV_URL);
  } else {
    // packaged: extraResources puts the client at resources/client
    const packaged = path.join(process.resourcesPath ?? '', 'client', 'index.html');
    const local = path.join(__dirname, '..', 'client', 'dist', 'index.html');
    win.loadFile(app.isPackaged ? packaged : local);
  }
}

app.whenReady().then(() => {
  trySpawnServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProc) { try { serverProc.kill(); } catch (e) { /* gone */ } }
  app.quit();
});
