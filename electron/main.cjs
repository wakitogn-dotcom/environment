const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

let mainWindow = null;

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function resolvePort() {
  if (await isPortFree(3000)) {
    return 3000;
  }
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/oauth/status`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('ReachPulse local server timed out starting.'));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

function isOAuthPopupUrl(urlStr) {
  return (
    urlStr.includes('facebook.com') ||
    urlStr.includes('twitter.com') ||
    urlStr.includes('x.com/i/oauth2') ||
    urlStr.startsWith('http://127.0.0.1:') ||
    urlStr.startsWith('http://localhost:')
  );
}

async function bootDesktopApp() {
  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  const envFile = path.join(userDataDir, '.env');
  const distDir = path.join(__dirname, '..', 'dist');
  const serverBundle = path.join(__dirname, '..', 'dist-server', 'server.cjs');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const port = await resolvePort();

  process.env.NODE_ENV = 'production';
  process.env.ELECTRON_DESKTOP = 'true';
  process.env.PORT = String(port);
  process.env.REACHPULSE_DATA_DIR = dataDir;
  process.env.REACHPULSE_DIST_DIR = distDir;
  process.env.REACHPULSE_ENV_FILE = envFile;
  if (!process.env.APP_URL) {
    process.env.APP_URL = `http://127.0.0.1:${port}`;
  }

  require(serverBundle);
  await waitForServer(port);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'ReachPulse — Social Reels Auto-Marketing',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 620,
          height: 760,
          autoHideMenuBar: true,
          parent: mainWindow,
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(bootDesktopApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
