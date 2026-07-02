const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db = require('./database/db');
const server = require('./server/server');
const settingsManager = require('./settings');

let mainWindow = null;
let projectorWindow = null;

// Read settings to configure hardware acceleration before app ready
const settings = settingsManager.load();
if (!settings.hardwareAcceleration) {
  console.log('Disabling Hardware Acceleration...');
  app.disableHardwareAcceleration();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0e150e', // matches background theme
    show: false
  });

  // Load index.html
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function createProjectorWindow() {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.focus();
    return;
  }

  projectorWindow = new BrowserWindow({
    width: 1024,
    height: 576,
    minWidth: 800,
    minHeight: 450,
    title: 'KantaBai Projector Screen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#000000',
    show: false
  });

  projectorWindow.loadFile(path.join(__dirname, 'renderer', 'projector.html'));

  projectorWindow.once('ready-to-show', () => {
    projectorWindow.show();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-status-change', true);
    }
  });

  projectorWindow.on('closed', () => {
    projectorWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projector-status-change', false);
    }
  });
}

// --- IPC Handlers ---

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Karaoke Video Library Directory'
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('settings:getPort', () => {
  const currentSettings = settingsManager.load();
  return currentSettings.serverPort;
});

ipcMain.on('window:setFullscreen', (event, flag) => {
  if (mainWindow) {
    mainWindow.setFullScreen(flag);
  }
});

// --- Projector Window Lifecycle and Routing IPCs ---

ipcMain.on('projector:open', () => {
  createProjectorWindow();
});

ipcMain.on('projector:close', () => {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.close();
  }
});

ipcMain.handle('projector:status', () => {
  return !!(projectorWindow && !projectorWindow.isDestroyed());
});

ipcMain.on('projector:setFullscreen', (event, flag) => {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.setFullScreen(flag);
  }
});

// Generic forwarding channel from control to projector
ipcMain.on('to:projector', (event, channel, data) => {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.webContents.send(channel, data);
  }
});

// Generic forwarding channel from projector to control
ipcMain.on('to:control', (event, channel, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
});

// --- App Lifecycle ---

app.whenReady().then(async () => {
  // Initialize Database
  try {
    await db.initDb();
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }

  // Start Server
  const currentSettings = settingsManager.load();
  try {
    await server.start(currentSettings.serverPort);
  } catch (err) {
    console.error(`Failed to start server on port ${currentSettings.serverPort}:`, err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Stop server on exit
  try {
    await server.stop();
  } catch (err) {
    console.error(err);
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
