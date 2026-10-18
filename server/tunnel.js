const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class TunnelManager {
  constructor() {
    this.status = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
    this.url = null;
    this.error = null;
    this.process = null;
    this.listeners = new Set();
  }

  findBinary() {
    // 1. Explicit env override
    if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
      return process.env.CLOUDFLARED_PATH;
    }

    // 2. Bundled bin folder in project
    const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    let localBin = path.join(__dirname, '..', 'bin', exeName);
    if (__dirname.includes('app.asar')) {
      localBin = localBin.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(localBin)) {
      return localBin;
    }

    if (process.resourcesPath) {
      const unpackedInResources = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', exeName);
      if (fs.existsSync(unpackedInResources)) {
        return unpackedInResources;
      }
    }

    // 3. Known Windows installations
    if (process.platform === 'win32') {
      const knownLocations = [
        'C:\\tmp\\testimonium-cloudflared\\cloudflared.exe',
        'C:\\Program Files\\cloudflared\\cloudflared.exe',
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
      ];
      for (const loc of knownLocations) {
        if (fs.existsSync(loc)) return loc;
      }
    }

    // 4. In System PATH
    try {
      const checkCmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared';
      const output = execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (output) {
        const firstLine = output.split(/\r?\n/)[0].trim();
        if (fs.existsSync(firstLine)) return firstLine;
        return 'cloudflared';
      }
    } catch (e) {
      // not in PATH
    }

    return null;
  }

  isAvailable() {
    return !!this.findBinary();
  }

  getStatus() {
    return {
      status: this.status,
      url: this.url,
      error: this.error,
      isAvailable: this.isAvailable()
    };
  }

  onStatusChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('[Tunnel] Listener error:', err);
      }
    }
  }

  start(port = 8080) {
    return new Promise((resolve, reject) => {
      if (this.status === 'running' && this.url) {
        return resolve(this.getStatus());
      }
      if (this.status === 'starting') {
        return resolve(this.getStatus());
      }

      const binary = this.findBinary();
      if (!binary) {
        this.status = 'error';
        this.error = 'Cloudflared executable not found on the system.';
        this.notifyListeners();
        return reject(new Error(this.error));
      }

      this.status = 'starting';
      this.error = null;
      this.url = null;
      this.notifyListeners();

      console.log(`[Tunnel] Launching Cloudflare Tunnel for port ${port} using: ${binary}`);

      try {
        this.process = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          windowsHide: true
        });
      } catch (err) {
        this.status = 'error';
        this.error = err.message;
        this.notifyListeners();
        return reject(err);
      }

      let urlDetected = false;
      const timeout = setTimeout(() => {
        if (!urlDetected && this.status === 'starting') {
          console.warn('[Tunnel] URL detection timed out after 30 seconds.');
          this.status = 'error';
          this.error = 'Connection timed out while waiting for Cloudflare Tunnel URL.';
          this.stop();
          reject(new Error(this.error));
        }
      }, 30000);

      const handleOutput = (data) => {
        const text = data.toString();
        // Regex looks for trycloudflare.com link
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
        if (match && !urlDetected) {
          urlDetected = true;
          clearTimeout(timeout);
          this.url = match[0];
          this.status = 'running';
          this.error = null;
          console.log(`[Tunnel] Cloudflare Tunnel established successfully: ${this.url}`);
          this.notifyListeners();
          resolve(this.getStatus());
        }
      };

      this.process.stdout.on('data', handleOutput);
      this.process.stderr.on('data', handleOutput);

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[Tunnel] Process error:', err);
        this.status = 'error';
        this.error = err.message;
        this.url = null;
        this.notifyListeners();
        if (!urlDetected) reject(err);
      });

      this.process.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[Tunnel] Process closed with code: ${code}`);
        const wasRunning = this.status === 'running' || this.status === 'starting';
        this.process = null;
        this.url = null;
        if (wasRunning && code !== 0 && code !== null) {
          this.status = 'error';
          this.error = `Cloudflare Tunnel exited unexpectedly with exit code ${code}.`;
        } else {
          this.status = 'stopped';
          this.error = null;
        }
        this.notifyListeners();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.process) {
        this.status = 'stopped';
        this.url = null;
        this.error = null;
        this.notifyListeners();
        return resolve(this.getStatus());
      }

      const pid = this.process.pid;
      this.status = 'stopped';
      this.url = null;
      this.error = null;

      if (process.platform === 'win32') {
        exec(`taskkill /pid ${pid} /f /t`, (err) => {
          if (err) console.warn('[Tunnel] taskkill note:', err.message);
          this.process = null;
          this.notifyListeners();
          resolve(this.getStatus());
        });
      } else {
        try {
          this.process.kill('SIGTERM');
        } catch (e) {
          // ignore
        }
        this.process = null;
        this.notifyListeners();
        resolve(this.getStatus());
      }
    });
  }
}

const tunnelManager = new TunnelManager();
module.exports = tunnelManager;
