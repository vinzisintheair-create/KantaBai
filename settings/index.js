const fs = require('fs');
const path = require('path');

let SETTINGS_FILE;
try {
  const { app } = require('electron');
  if (app) {
    SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
  } else {
    SETTINGS_FILE = path.join(__dirname, 'settings.json');
  }
} catch (e) {
  SETTINGS_FILE = path.join(__dirname, 'settings.json');
}

const DEFAULT_SETTINGS = {
  libraryPath: 'E:\\SongBook',
  serverPort: 8080,
  theme: 'Midnight (Dark)',
  ambientVisualizer: 'Neon Pulse (Default)',
  masterVolume: 85,
  adminPassword: 'admin',
  fullscreen: true,
  hardwareAcceleration: true
};

function load() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading settings, using defaults:', err);
  }
  
  // If settings don't exist or fail to parse, write defaults
  save(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

function save(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving settings:', err);
    return false;
  }
}

module.exports = {
  load,
  save,
  DEFAULT_SETTINGS
};
