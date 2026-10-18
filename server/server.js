const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ip = require('ip');
const QRCode = require('qrcode');
const db = require('../database/db');
const scanner = require('../database/scanner');
const settingsManager = require('../settings');
const fs = require('fs');
const os = require('os');
const tunnel = require('./tunnel');

// In packaged Electron apps, external binaries cannot be executed from inside asar
if (__dirname.includes('app.asar')) {
  const unpackedRoot = path.join(__dirname.split('app.asar')[0], 'app.asar.unpacked');
  process.env.YOUTUBE_DL_DIR = path.join(unpackedRoot, 'node_modules', 'youtube-dl-exec', 'bin');
}

const youtubedl = require('youtube-dl-exec');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && ffmpegPath.includes('app.asar')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
} catch (e) {
  console.warn('ffmpeg-static not available:', e.message);
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    
    // Skip virtual/loopback/wsl/docker/vpn interfaces if possible
    const isVirtual = lowerName.includes('virtualbox') || 
                      lowerName.includes('vmware') || 
                      lowerName.includes('host-only') || 
                      lowerName.includes('vethernet') || 
                      lowerName.includes('wsl') || 
                      lowerName.includes('docker') || 
                      lowerName.includes('vpn') || 
                      lowerName.includes('loopback');

    for (const net of interfaces[name]) {
      // We only want IPv4 non-internal addresses
      if (net.family === 'IPv4' && !net.internal) {
        let score = 0;
        
        // Prefer Wi-Fi or Ethernet interfaces
        if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan')) {
          score += 10;
        } else if (lowerName.includes('ethernet') || lowerName.includes('lan')) {
          score += 8;
        }
        
        // Penalize virtual adapters
        if (isVirtual) {
          score -= 20;
        }

        // Prefer common home/office subnets: 192.168.x.x, 10.x.x.x, 172.16.x.x to 172.31.x.x
        const ipParts = net.address.split('.');
        const firstOctet = parseInt(ipParts[0], 10);
        const secondOctet = parseInt(ipParts[1], 10);
        if (firstOctet === 192 && secondOctet === 168) {
          score += 5;
        } else if (firstOctet === 10) {
          score += 5;
        } else if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) {
          score += 5;
        }
        
        candidates.push({ address: net.address, score });
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].address;
  }

  try {
    return ip.address() || '127.0.0.1';
  } catch (e) {
    return '127.0.0.1';
  }
}


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

  // Relay Cloudflare Tunnel status to connected clients via Socket.IO
  tunnel.onStatusChange((status) => {
    if (io) {
      io.emit('tunnel_status', status);
    }
  });

  app.use(express.json());
  
  // Redirect root path to phone.html
  app.get('/', (req, res) => {
    res.redirect('/phone.html');
  });
  
  // Serve the phone web companion assets
  app.use(express.static(path.join(__dirname, 'public')));

  // Serve the lyrics/video library static assets dynamically from configured libraryPath
  app.use('/media', (req, res, next) => {
    const currentSettings = settingsManager.load();
    if (currentSettings.libraryPath && fs.existsSync(currentSettings.libraryPath)) {
      return express.static(currentSettings.libraryPath)(req, res, next);
    }
    next();
  });

  // --- API Routes ---

  // Get songs list with optional search and category filters
  app.get('/api/songs', async (req, res) => {
    try {
      const { q, category, sortBy } = req.query;
      let songs;
      if (!q && (!category || category === 'All Songs') && sortBy) {
        songs = await db.getAllSongs(sortBy);
      } else {
        songs = await db.searchSongs(q, category);
      }
      res.json({ success: true, songs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get song details by assigned song number
  app.get('/api/songs/by-number/:number', async (req, res) => {
    try {
      const song = await db.getSongByNumber(req.params.number);
      if (!song) {
        return res.status(404).json({ success: false, error: `Song #${req.params.number} not found in Songbook.` });
      }
      res.json({ success: true, song });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Update song number (Admin feature)
  app.put('/api/songs/:id/number', async (req, res) => {
    try {
      const { songNumber } = req.body;
      const updated = await db.updateSongNumber(req.params.id, songNumber);
      io.emit('songbook_updated');
      res.json({ success: true, song: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
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

  // Add song to queue by Song ID
  app.post('/api/queue', async (req, res) => {
    try {
      const { songId, singerName, isRemote, adminAuth } = req.body;
      if (!songId || !singerName) {
        return res.status(400).json({ success: false, error: 'Song ID and Singer Name are required.' });
      }

      // Check user remote input permission if request is from mobile remote
      const currentSettings = settingsManager.load();
      if (isRemote && currentSettings.userRemoteInputEnabled === false) {
        if (adminAuth !== currentSettings.adminPassword) {
          return res.status(403).json({
            success: false,
            error: 'User remote input is disabled by Administrator. Only the admin can queue songs.'
          });
        }
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

  // Nostalgic Videoke Remote: Add song to queue by assigned song number!
  app.post('/api/queue/by-number', async (req, res) => {
    try {
      const { songNumber, singerName, isRemote, adminAuth } = req.body;
      if (!songNumber) {
        return res.status(400).json({ success: false, error: 'Song number is required.' });
      }

      // Enforce Admin permissions if user remote input is disabled
      const currentSettings = settingsManager.load();
      if (isRemote !== false && currentSettings.userRemoteInputEnabled === false) {
        if (adminAuth !== currentSettings.adminPassword) {
          return res.status(403).json({
            success: false,
            error: 'User remote input is disabled by Administrator. Only the admin can queue songs.'
          });
        }
      }

      const song = await db.getSongByNumber(songNumber);
      if (!song) {
        return res.status(404).json({ success: false, error: `Song #${songNumber} not found in Songbook.` });
      }

      const effectiveSinger = (singerName && singerName.trim()) ? singerName.trim() : 'Singer';
      await db.addToQueue(song.id, effectiveSinger);

      const nowPlaying = await db.getNowPlaying();
      const queue = await db.getQueue();
      if (!nowPlaying && queue.length > 0) {
        await db.setSongSinging(queue[0].queue_id);
      }

      await broadcastQueueUpdate();

      // Emit nostalgic reservation event for TV projector notification!
      io.emit('song_reserved', {
        song,
        singerName: effectiveSinger,
        songNumber: song.song_number
      });

      res.json({ success: true, song, singerName: effectiveSinger });
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

  // --- Cloudflare Tunnel Routes ---

  // Get current Cloudflare Tunnel status
  app.get('/api/tunnel', (req, res) => {
    res.json({ success: true, tunnel: tunnel.getStatus() });
  });

  // Start Cloudflare Tunnel
  app.post('/api/tunnel/start', async (req, res) => {
    try {
      const settings = settingsManager.load();
      const status = await tunnel.start(settings.serverPort || 8080);
      res.json({ success: true, tunnel: status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, tunnel: tunnel.getStatus() });
    }
  });

  // Stop Cloudflare Tunnel
  app.post('/api/tunnel/stop', async (req, res) => {
    try {
      const status = await tunnel.stop();
      res.json({ success: true, tunnel: status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, tunnel: tunnel.getStatus() });
    }
  });

  // Generate QR Code data URL for connecting phone companion
  app.get('/api/qr', async (req, res) => {
    try {
      const localIp = getLocalIpAddress();
      const settings = settingsManager.load();
      const localUrl = `http://${localIp}:${settings.serverPort}`;
      const localQrCodeDataUrl = await QRCode.toDataURL(localUrl);

      const tunnelInfo = tunnel.getStatus();
      let tunnelQrCodeDataUrl = null;
      if (tunnelInfo.url) {
        tunnelQrCodeDataUrl = await QRCode.toDataURL(tunnelInfo.url);
      }

      // If client requests mode=tunnel and tunnel has an active URL, default activeUrl to tunnelUrl
      const mode = req.query.mode;
      const isTunnelPreferred = mode === 'tunnel' && !!tunnelInfo.url;
      const activeUrl = isTunnelPreferred ? tunnelInfo.url : localUrl;
      const activeQr = isTunnelPreferred ? tunnelQrCodeDataUrl : localQrCodeDataUrl;

      res.json({
        success: true,
        url: activeUrl,
        qrCodeDataUrl: activeQr,
        local: {
          url: localUrl,
          qrCodeDataUrl: localQrCodeDataUrl
        },
        tunnel: {
          status: tunnelInfo.status,
          url: tunnelInfo.url,
          qrCodeDataUrl: tunnelQrCodeDataUrl,
          isAvailable: tunnelInfo.isAvailable,
          error: tunnelInfo.error
        }
      });
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

  // Save settings and trigger library scan if path changed
  app.post('/api/settings', async (req, res) => {
    try {
      const newSettings = req.body;
      const oldSettings = settingsManager.load();
      const merged = { ...oldSettings, ...newSettings };
      settingsManager.save(merged);

      let scanResult = null;
      // Scan library automatically if libraryPath changed
      if (merged.libraryPath && merged.libraryPath !== oldSettings.libraryPath) {
        scanResult = await scanner.scanLibrary(merged.libraryPath);
      }

      io.emit('settings_updated', { settings: merged });
      io.emit('songbook_updated');
      res.json({ success: true, settings: merged, scanResult });
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
  function parseYoutubeTitle(originalTitle, fallbackArtist = '') {
    let clean = (originalTitle || '')
      .replace(/\s*[([].*?(karaoke|lyrics|instrumental|version|official|cover|tribute|with).*?[\])]/gi, '')
      .replace(/\s*\|\s*karaoke/gi, '')
      .replace(/\s*\|\s*instrumental/gi, '')
      .replace(/\s*-\s*karaoke/gi, '')
      .replace(/karaoke\s*-\s*/gi, '')
      .replace(/instrumental\s*-\s*/gi, '')
      .trim();

    let artist = '';
    let title = clean;

    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length >= 2) {
        // YouTube karaoke video titles are formatted as "TITLE - ARTIST"
        title = parts[0].trim();
        artist = parts.slice(1).join('-').trim();
      }
    }

    if (!title) title = originalTitle || 'Unknown Title';
    if (!artist) artist = fallbackArtist || 'YouTube';

    return { artist, title };
  }

  // Download YouTube video endpoint
  app.post('/api/download', async (req, res) => {
    try {
      const { url, singerName } = req.body;
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

      io.emit('download_progress', { url, step: 'metadata', message: 'Extracting video info from YouTube...' });
      console.log(`[YouTube Download] Fetching metadata for url: ${url}`);

      const metaOpts = {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true
      };
      if (ffmpegPath) {
        metaOpts.ffmpegLocation = ffmpegPath;
      }

      let info;
      try {
        info = await youtubedl(url, metaOpts);
      } catch (metaErr) {
        console.error('[YouTube Download] Metadata fetch failed:', metaErr);
        return res.status(400).json({ success: false, error: 'Failed to retrieve YouTube video details. Ensure the URL is valid.' });
      }

      if (!info || !info.title) {
        return res.status(400).json({ success: false, error: 'Could not resolve title metadata from URL.' });
      }

      const fallbackArtist = info.artist || info.creator || info.uploader || 'YouTube';
      const parsed = parseYoutubeTitle(info.title, fallbackArtist);

      // Sanitize the filename to be safe for OS filesystem
      const sanitizedArtist = parsed.artist.replace(/[\\/:*?"<>|]/g, '_');
      const sanitizedTitle = parsed.title.replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${sanitizedArtist} - ${sanitizedTitle}.mp4`;
      const destPath = path.join(currentSettings.libraryPath, filename);
      const relativePath = filename;
      const category = 'YouTube';

      let songRecord = null;
      let alreadyExists = false;

      if (fs.existsSync(destPath)) {
        console.log(`[YouTube Download] File already exists: ${destPath}. Skipping download.`);
        alreadyExists = true;
        songRecord = await db.addSong({
          title: parsed.title,
          artist: parsed.artist,
          file_path: relativePath,
          category: category
        });
      } else {
        io.emit('download_progress', { url, step: 'downloading', message: `Downloading and merging audio/video for "${parsed.title}"...` });
        console.log(`[YouTube Download] Starting download for: ${url} -> ${destPath}`);

        const dlOpts = {
          output: destPath,
          format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
          noCheckCertificates: true,
          noWarnings: true,
          noPart: true,
          windowsFilenames: true
        };
        if (ffmpegPath) {
          dlOpts.ffmpegLocation = ffmpegPath;
        }

        await youtubedl(url, dlOpts);
        console.log(`[YouTube Download] Download completed successfully: ${destPath}`);

        songRecord = await db.addSong({
          title: parsed.title,
          artist: parsed.artist,
          file_path: relativePath,
          category: category
        });
      }

      io.emit('songbook_updated');

      // If singerName provided, automatically add to active queue!
      let queued = false;
      if (singerName && singerName.trim() && songRecord && songRecord.id) {
        await db.addToQueue(songRecord.id, singerName.trim());
        const nowPlaying = await db.getNowPlaying();
        const queue = await db.getQueue();
        if (!nowPlaying && queue.length > 0) {
          await db.setSongSinging(queue[0].queue_id);
        }
        await broadcastQueueUpdate();
        queued = true;
      }

      io.emit('download_progress', { url, step: 'done', message: 'Ready to sing!', done: true });

      res.json({
        success: true,
        alreadyExists,
        queued,
        song: songRecord
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
    const tunnelInfo = tunnel.getStatus();
    socket.emit('initial_status', { queue, nowPlaying, settings, tunnel: tunnelInfo });
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

      // Auto-start Cloudflare Tunnel on startup if configured
      if (currentSettings.autoStartTunnel) {
        tunnel.start(port).catch(err => console.error('Auto-start tunnel failed:', err.message));
      }
      
      resolve(server);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    tunnel.stop().finally(() => {
      if (server) {
        server.close(() => {
          console.log('KantaBai server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  start,
  stop,
  broadcastQueueUpdate
};
