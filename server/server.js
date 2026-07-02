const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ip = require('ip');
const QRCode = require('qrcode');
const db = require('../database/db');
const scanner = require('../database/scanner');
const settingsManager = require('../settings');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');

let app = null;
let server = null;
let io = null;

function createServer() {
  app = express();
  server = http.createServer(app);
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  app.use(express.json());
  
  // Redirect root path to phone.html
  app.get('/', (req, res) => {
    res.redirect('/phone.html');
  });
  
  // Serve the phone web companion assets
  app.use(express.static(path.join(__dirname, 'public')));

  // Serve the lyrics/video library static assets
  // This will be dynamically updated when the settings are loaded
  let settings = settingsManager.load();
  if (settings.libraryPath) {
    app.use('/media', express.static(settings.libraryPath));
  }

  // --- API Routes ---

  // Get songs list with optional search and category filters
  app.get('/api/songs', async (req, res) => {
    try {
      const { q, category } = req.query;
      const songs = await db.searchSongs(q, category);
      res.json({ success: true, songs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get current queue
  app.get('/api/queue', async (req, res) => {
    try {
      const queue = await db.getQueue();
      const nowPlaying = await db.getNowPlaying();
      res.json({ success: true, queue, nowPlaying });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Add song to queue
  app.post('/api/queue', async (req, res) => {
    try {
      const { songId, singerName } = req.body;
      if (!songId || !singerName) {
        return res.status(400).json({ success: false, error: 'Song ID and Singer Name are required.' });
      }
      await db.addToQueue(songId, singerName.trim());
      
      // If there is currently no song singing, automatically set this first song to 'singing' state
      const nowPlaying = await db.getNowPlaying();
      const queue = await db.getQueue();
      if (!nowPlaying && queue.length > 0) {
        await db.setSongSinging(queue[0].queue_id);
      }
      
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete song from queue
  app.delete('/api/queue/:id', async (req, res) => {
    try {
      await db.removeFromQueue(req.params.id);
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Clear all upcoming songs in queue
  app.post('/api/queue/clear', async (req, res) => {
    try {
      await db.clearQueue();
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Reorder queue items
  app.post('/api/queue/reorder', async (req, res) => {
    try {
      const { orders } = req.body;
      if (!Array.isArray(orders)) {
        return res.status(400).json({ success: false, error: 'Orders must be an array.' });
      }
      await db.updateQueueOrder(orders);
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Set queue item status to singing
  app.post('/api/queue/singing/:id', async (req, res) => {
    try {
      await db.setSongSinging(req.params.id);
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Set queue item status to finished (adding to history)
  app.post('/api/queue/finish/:id', async (req, res) => {
    try {
      await db.setSongFinished(req.params.id);
      await broadcastQueueUpdate();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Generate QR Code data URL for connecting phone companion
  app.get('/api/qr', async (req, res) => {
    try {
      const localIp = ip.address();
      const settings = settingsManager.load();
      const url = `http://${localIp}:${settings.serverPort}`;
      const qrCodeDataUrl = await QRCode.toDataURL(url);
      res.json({ success: true, url, qrCodeDataUrl });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get settings
  app.get('/api/settings', (req, res) => {
    res.json({ success: true, settings: settingsManager.load() });
  });

  // Verify admin password from companion app
  app.post('/api/admin/verify', (req, res) => {
    try {
      const { password } = req.body;
      const settings = settingsManager.load();
      if (password === settings.adminPassword) {
        res.json({ success: true });
      } else {
        res.json({ success: false, error: 'Incorrect Administrator Password.' });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Save settings and update express static route if library path changed
  app.post('/api/settings', async (req, res) => {
    try {
      const newSettings = req.body;
      const oldSettings = settingsManager.load();
      settingsManager.save(newSettings);

      // Re-configure media static path if libraryPath changed
      if (newSettings.libraryPath && newSettings.libraryPath !== oldSettings.libraryPath) {
        // Remove existing /media routers
        app._router.stack = app._router.stack.filter(layer => {
          return !layer.regexp.test('/media');
        });
        // Add new static handler
        app.use('/media', express.static(newSettings.libraryPath));
        
        // Scan library automatically
        await scanner.scanLibrary(newSettings.libraryPath);
      }

      io.emit('settings_updated', { settings: newSettings });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Trigger library scan manually
  app.post('/api/scan', async (req, res) => {
    try {
      const currentSettings = settingsManager.load();
      if (!currentSettings.libraryPath) {
        return res.status(400).json({ success: false, error: 'Library path is not configured.' });
      }
      const result = await scanner.scanLibrary(currentSettings.libraryPath);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to parse YouTube titles into Artist and Song Title
  function parseYoutubeTitle(originalTitle) {
    let clean = originalTitle
      .replace(/\s*[([].*?(karaoke|lyrics|instrumental|version|official|cover|tribute|with).*?[\])]/gi, '')
      .replace(/\s*\|\s*karaoke/gi, '')
      .replace(/\s*\|\s*instrumental/gi, '')
      .replace(/\s*-\s*karaoke/gi, '')
      .replace(/karaoke\s*-\s*/gi, '')
      .replace(/instrumental\s*-\s*/gi, '')
      .trim();

    let artist = 'YouTube';
    let title = clean;

    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join('-').trim();
      }
    }

    if (!title) title = originalTitle || 'Unknown Title';
    if (!artist) artist = 'YouTube';

    return { artist, title };
  }

  // Download YouTube video endpoint
  app.post('/api/download', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'YouTube URL is required.' });
      }

      const currentSettings = settingsManager.load();
      if (!currentSettings.libraryPath) {
        return res.status(400).json({ success: false, error: 'Library path is not configured. Configure it in desktop settings.' });
      }

      if (!fs.existsSync(currentSettings.libraryPath)) {
        fs.mkdirSync(currentSettings.libraryPath, { recursive: true });
      }

      console.log(`[YouTube Download] Fetching metadata for url: ${url}`);
      let info;
      try {
        info = await youtubedl(url, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          noWarnings: true,
          preferFreeFormats: true
        });
      } catch (metaErr) {
        console.error('[YouTube Download] Metadata fetch failed:', metaErr);
        return res.status(400).json({ success: false, error: 'Failed to retrieve YouTube video details. Ensure the URL is valid.' });
      }

      if (!info || !info.title) {
        return res.status(400).json({ success: false, error: 'Could not resolve title metadata from URL.' });
      }

      const parsed = parseYoutubeTitle(info.title);
      // Sanitize the filename to be safe for OS filesystem
      const sanitizedArtist = parsed.artist.replace(/[\\/:*?"<>|]/g, '_');
      const sanitizedTitle = parsed.title.replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${sanitizedArtist} - ${sanitizedTitle}.mp4`;
      const destPath = path.join(currentSettings.libraryPath, filename);
      const relativePath = filename;

      const category = 'YouTube';

      if (fs.existsSync(destPath)) {
        console.log(`[YouTube Download] File already exists: ${destPath}. Skipping download.`);
        await db.addSong({
          title: parsed.title,
          artist: parsed.artist,
          file_path: relativePath,
          category: category
        });
        io.emit('songbook_updated');
        return res.json({
          success: true,
          alreadyExists: true,
          song: {
            title: parsed.title,
            artist: parsed.artist,
            category: category
          }
        });
      }

      console.log(`[YouTube Download] Starting download for: ${url} -> ${destPath}`);
      await youtubedl(url, {
        output: destPath,
        format: 'best[ext=mp4]/best',
        noCheckCertificates: true,
        noWarnings: true
      });

      console.log(`[YouTube Download] Download completed successfully: ${destPath}`);
      await db.addSong({
        title: parsed.title,
        artist: parsed.artist,
        file_path: relativePath,
        category: category
      });

      io.emit('songbook_updated');

      res.json({
        success: true,
        song: {
          title: parsed.title,
          artist: parsed.artist,
          category: category
        }
      });
    } catch (err) {
      console.error('[YouTube Download] Handler error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Socket.IO synchronization
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send initial status
    sendCurrentStatus(socket);

    socket.on('join_dashboard', () => {
      socket.join('dashboards');
      console.log(`Socket ${socket.id} joined dashboards room`);
    });

    socket.on('play_state_change', (data) => {
      // Broadcast play, pause, skip commands to the dashboard or other clients
      socket.broadcast.emit('play_state_command', data);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return server;
}

async function sendCurrentStatus(socket) {
  try {
    const queue = await db.getQueue();
    const nowPlaying = await db.getNowPlaying();
    const settings = settingsManager.load();
    socket.emit('initial_status', { queue, nowPlaying, settings });
  } catch (err) {
    console.error('Error sending initial status:', err);
  }
}

async function broadcastQueueUpdate() {
  if (!io) return;
  const queue = await db.getQueue();
  const nowPlaying = await db.getNowPlaying();
  io.emit('queue_updated', { queue, nowPlaying });
}

function start(port = 8080) {
  if (!server) {
    createServer();
  }
  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', (err) => {
      if (err) return reject(err);
      console.log(`KantaBai server running on http://localhost:${port}`);
      
      // Auto-scan library on startup if configured
      const currentSettings = settingsManager.load();
      if (currentSettings.libraryPath) {
        scanner.scanLibrary(currentSettings.libraryPath)
          .catch(err => console.error('Auto-scan failed:', err));
      }
      
      resolve(server);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('KantaBai server stopped.');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  start,
  stop,
  broadcastQueueUpdate
};
