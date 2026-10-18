let socket = null;
let apiBaseUrl = '';

// Override fetch for Electron file:// origin compatibility
if (window.electronAPI) {
  const originalFetch = window.fetch;
  window.fetch = async function(resource, options) {
    if (typeof resource === 'string' && resource.startsWith('/')) {
      if (!apiBaseUrl) {
        try {
          const port = await window.electronAPI.getServerPort();
          apiBaseUrl = `http://localhost:${port}`;
        } catch (err) {
          console.error(err);
        }
      }
      resource = apiBaseUrl + resource;
    }
    return originalFetch(resource, options);
  };
}

// State variables
let currentTab = 'home';
let songsList = [];
let queueList = [];
let nowPlaying = null;
let systemSettings = null;
let isAdminVerified = false;
let idleTimeout = null;
let currentVideoPath = '';

// Helper to safely URL encode filepath segments for special character support
function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// DOM Elements
const sidebarNav = document.getElementById('sidebar-nav');
const navItems = document.querySelectorAll('.nav-item');
const searchInput = document.getElementById('search-input');
const songbookCount = document.getElementById('songbook-count');
const songbookGrid = document.getElementById('songbook-grid');
const queueBadge = document.getElementById('queue-badge');
const queueListContainer = document.getElementById('queue-list-container');
const homeRecentSongs = document.getElementById('home-recent-songs');
const homeCategories = document.getElementById('home-categories');

// Now Playing elements (Dashboard)
const npTitle = document.getElementById('now-playing-title');
const npArtist = document.getElementById('now-playing-artist');
const npSinger = document.getElementById('now-playing-singer');
const npProgress = document.getElementById('playback-progress');
const npTimeCur = document.getElementById('playback-time-cur');
const npTimeTotal = document.getElementById('playback-time-total');
const queueTimeEst = document.getElementById('queue-time-est');
const queueCountText = document.getElementById('queue-count-text');

// Footer elements
const footerSongTitle = document.getElementById('footer-song-title');
const footerSingerName = document.getElementById('footer-singer-name');
const footerVolumeSlider = document.getElementById('footer-volume-slider');
const footerPlayBtnIcon = document.getElementById('footer-play-btn-icon');
const footerPlaybackIcon = document.getElementById('footer-playback-icon');

// Playback State Tracking
let isPlaybackActive = false;

// Modals
const modalQr = document.getElementById('modal-qr');
const qrImage = document.getElementById('qr-image');
const qrUrlText = document.getElementById('qr-url-text');
const modalAdmin = document.getElementById('modal-admin');
const modalAdminPassword = document.getElementById('modal-admin-password');

// Settings inputs
const settingsPort = document.getElementById('settings-port');
const settingsLibraryPath = document.getElementById('settings-library-path');
const settingsVolume = document.getElementById('settings-volume');
const settingsVolumeLabel = document.getElementById('settings-volume-label');
const settingsFullscreen = document.getElementById('settings-fullscreen');
const settingsHardware = document.getElementById('settings-hardware');
const settingsSongCount = document.getElementById('settings-song-count');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  // Resolve API Base URL for Electron
  if (window.electronAPI) {
    try {
      const port = await window.electronAPI.getServerPort();
      apiBaseUrl = `http://localhost:${port}`;
    } catch (err) {
      console.error('Failed to get server port:', err);
    }
  }

  // Hide Intro Screen after 3 seconds
  setTimeout(() => {
    const intro = document.getElementById('intro-screen');
    intro.style.opacity = 0;
    setTimeout(() => {
      intro.style.display = 'none';
    }, 1000);
  }, 3000);

  setupEventListeners();
  
  try {
    await initSocket();
  } catch (err) {
    console.error('Socket initialization failed:', err);
  }
  
  loadAllSongs();
  loadQueue();
  loadRecentHistory();
});

// Socket dynamic loader
async function initSocket() {
  const port = await window.electronAPI.getServerPort();
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `http://localhost:${port}/socket.io/socket.io.js`;
    script.onload = () => {
      socket = io(`http://localhost:${port}`);
      setupSocketHandlers();
      resolve();
    };
    script.onerror = (err) => {
      reject(err);
    };
    document.head.appendChild(script);
  });
}

function setupSocketHandlers() {
  // Socket integration
  socket.on('initial_status', (data) => {
    systemSettings = data.settings;
    updateSettingsUI(data.settings);
    updateQueueUI(data.queue, data.nowPlaying);
    if (data.tunnel) {
      updateTunnelUI(data.tunnel);
    }
    generateQrCode();
  });

  socket.on('tunnel_status', (data) => {
    updateTunnelUI(data);
    generateQrCode();
  });

  socket.on('queue_updated', (data) => {
    updateQueueUI(data.queue, data.nowPlaying);
  });

  socket.on('settings_updated', (data) => {
    systemSettings = data.settings;
    updateSettingsUI(data.settings);
  });

  socket.on('songbook_updated', () => {
    loadAllSongs();
  });

  socket.on('song_reserved', (data) => {
    if (window.electronAPI) {
      window.electronAPI.sendToProjector('projector-reserved', data);
    }
  });

  // Triggered by companion phone or keyboard commands
  socket.on('play_state_command', (data) => {
    if (data.action === 'play') {
      playVideo();
    } else if (data.action === 'pause') {
      pauseVideo();
    } else if (data.action === 'skip') {
      skipSong();
    } else if (data.action === 'restart') {
      restartSong();
    } else if (data.action === 'stop') {
      stopVideo();
    }
  });

  // --- IPC Listeners from Projector Window ---
  if (window.electronAPI) {
    window.electronAPI.onControlMessage('projector-status-change', (isOpen) => {
      const btn = document.getElementById('btn-toggle-projector');
      if (!btn) return;
      if (isOpen) {
        btn.classList.add('text-primary');
        btn.classList.remove('text-on-surface-variant');
        btn.title = 'Close Projector Screen';
        // Sync state to newly opened projector
        syncPlaybackToProjector();
      } else {
        btn.classList.remove('text-primary');
        btn.classList.add('text-on-surface-variant');
        btn.title = 'Open Projector Screen';
      }
    });

    window.electronAPI.onControlMessage('projector-ready', () => {
      syncPlaybackToProjector();
    });

    window.electronAPI.onControlMessage('projector-timeupdate', (data) => {
      updatePlaybackProgress(data.currentTime, data.duration);
    });

    window.electronAPI.onControlMessage('projector-play-state', (state) => {
      isPlaybackActive = (state === 'play');
      if (isPlaybackActive) {
        footerPlayBtnIcon.textContent = 'pause';
        footerPlaybackIcon.classList.add('animate-spin');
      } else {
        footerPlayBtnIcon.textContent = 'play_arrow';
        footerPlaybackIcon.classList.remove('animate-spin');
      }
    });

    window.electronAPI.onControlMessage('projector-ended', () => {
      handleVideoEnded();
    });
  }
}

function syncPlaybackToProjector() {
  if (!window.electronAPI) return;
  
  if (nowPlaying) {
    const videoUrl = `${apiBaseUrl}/media/${encodePath(nowPlaying.file_path)}`;
    window.electronAPI.sendToProjector('projector-load', {
      src: videoUrl,
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      singer: nowPlaying.singer_name,
      songNumber: nowPlaying.song_number
    });
    
    window.electronAPI.sendToProjector(isPlaybackActive ? 'projector-play' : 'projector-pause');
  } else {
    window.electronAPI.sendToProjector('projector-load', {
      src: null,
      title: '--',
      artist: '--',
      singer: '--'
    });
  }

  // Sync volume
  const vol = parseInt(footerVolumeSlider.value) || 85;
  window.electronAPI.sendToProjector('projector-volume', vol);

  // Sync queue
  window.electronAPI.sendToProjector('projector-queue', { queue: queueList });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Navigation
  sidebarNav.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    if (!navItem) return;
    
    e.preventDefault();
    const tabName = navItem.getAttribute('data-tab');
    switchTab(tabName);
  });

  // Category selection cards (Home)
  homeCategories.addEventListener('click', (e) => {
    const card = e.target.closest('.category-card');
    if (!card) return;
    const cat = card.getAttribute('data-category');
    switchTab('songbook');
    filterSongbookCategory(cat);
  });

  // Category filter bar (Songbook)
  document.getElementById('songbook-categories-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    
    // Toggle active state
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.className = 'cat-btn px-5 py-1.5 rounded-full border border-outline-variant text-on-surface-variant font-medium text-xs hover:border-primary hover:text-primary transition-all';
    });
    btn.className = 'cat-btn px-5 py-1.5 rounded-full bg-secondary text-on-secondary font-bold text-xs transition-all hover:scale-105';
    
    const cat = btn.getAttribute('data-cat');
    filterSongbookCategory(cat);
  });

  // Search input
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (currentTab !== 'songbook') {
      switchTab('songbook');
    }
    loadAllSongs(val);
  });

  // Connect Phone QR Toggle
  document.getElementById('btn-connect-phone').addEventListener('click', () => {
    modalQr.classList.remove('hidden');
    generateQrCode();
  });
  document.getElementById('btn-header-qr').addEventListener('click', () => {
    modalQr.classList.remove('hidden');
    generateQrCode();
  });
  document.getElementById('btn-close-qr').addEventListener('click', () => {
    modalQr.classList.add('hidden');
  });

  // QR Modal Tabs
  const tabQrLocal = document.getElementById('tab-qr-local');
  const tabQrTunnel = document.getElementById('tab-qr-tunnel');
  const paneQrLocal = document.getElementById('pane-qr-local');
  const paneQrTunnel = document.getElementById('pane-qr-tunnel');

  if (tabQrLocal && tabQrTunnel) {
    tabQrLocal.addEventListener('click', () => {
      tabQrLocal.className = 'py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 bg-primary text-on-primary shadow-sm';
      tabQrTunnel.className = 'py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 text-on-surface-variant hover:text-white';
      paneQrLocal.classList.remove('hidden');
      paneQrTunnel.classList.add('hidden');
    });

    tabQrTunnel.addEventListener('click', () => {
      tabQrTunnel.className = 'py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 bg-primary text-on-primary shadow-sm';
      tabQrLocal.className = 'py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 text-on-surface-variant hover:text-white';
      paneQrTunnel.classList.remove('hidden');
      paneQrLocal.classList.add('hidden');
    });
  }

  // Tunnel Start / Stop / Retry Buttons in Modal and Settings
  const btnStartTunnelModal = document.getElementById('btn-start-tunnel-modal');
  if (btnStartTunnelModal) btnStartTunnelModal.addEventListener('click', startCloudflareTunnel);

  const btnStopTunnelModal = document.getElementById('btn-stop-tunnel-modal');
  if (btnStopTunnelModal) btnStopTunnelModal.addEventListener('click', stopCloudflareTunnel);

  const btnRetryTunnelModal = document.getElementById('btn-retry-tunnel-modal');
  if (btnRetryTunnelModal) btnRetryTunnelModal.addEventListener('click', startCloudflareTunnel);

  const btnToggleTunnelSettings = document.getElementById('btn-toggle-tunnel-settings');
  if (btnToggleTunnelSettings) {
    btnToggleTunnelSettings.addEventListener('click', () => {
      if (latestTunnelState.status === 'running') {
        stopCloudflareTunnel();
      } else {
        startCloudflareTunnel();
      }
    });
  }

  // Copy URL Helpers
  const copyHelper = (text, btn) => {
    if (!text || text.includes('...')) return;
    navigator.clipboard.writeText(text).then(() => {
      const origHtml = btn.innerHTML;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm text-primary">done</span>';
      setTimeout(() => { btn.innerHTML = origHtml; }, 1500);
    });
  };

  const btnCopyLocal = document.getElementById('btn-copy-local-url');
  if (btnCopyLocal) {
    btnCopyLocal.addEventListener('click', () => {
      copyHelper(qrUrlText ? qrUrlText.textContent : '', btnCopyLocal);
    });
  }

  const btnCopyTunnel = document.getElementById('btn-copy-tunnel-url');
  if (btnCopyTunnel) {
    btnCopyTunnel.addEventListener('click', () => {
      const el = document.getElementById('qr-tunnel-url-text');
      copyHelper(el ? el.textContent : '', btnCopyTunnel);
    });
  }

  const btnCopySettingsTunnel = document.getElementById('btn-copy-settings-tunnel-url');
  if (btnCopySettingsTunnel) {
    btnCopySettingsTunnel.addEventListener('click', () => {
      const el = document.getElementById('settings-tunnel-url-text');
      copyHelper(el ? el.textContent : '', btnCopySettingsTunnel);
    });
  }

  // Auto-start tunnel checkbox change
  const autoStartTunnelEl = document.getElementById('settings-autostart-tunnel');
  if (autoStartTunnelEl) {
    autoStartTunnelEl.addEventListener('change', () => {
      saveSettings();
    });
  }

  // Admin Verification
  document.getElementById('btn-admin-mode').addEventListener('click', () => {
    if (isAdminVerified) {
      // Toggle off admin mode
      isAdminVerified = false;
      document.getElementById('admin-status-text').textContent = 'Guest User';
      document.getElementById('btn-admin-mode').innerHTML = `
        <span class="material-symbols-outlined text-[20px]">admin_panel_settings</span>
        <span>Admin Mode</span>
      `;
      loadQueue(); // Refresh to hide delete icons
    } else {
      modalAdmin.classList.remove('hidden');
    }
  });

  document.getElementById('btn-close-admin-modal').addEventListener('click', () => {
    modalAdmin.classList.add('hidden');
  });

  // Singer Name Modal Events
  document.getElementById('btn-close-singer-modal').addEventListener('click', () => {
    document.getElementById('modal-singer').classList.add('hidden');
  });

  const btnAdd = document.getElementById('btn-modal-add-to-queue');
  const inputSinger = document.getElementById('modal-singer-name-input');

  const submitSinger = async () => {
    if (!pendingSongQueueId) return;
    const name = inputSinger.value.trim() || 'Guest';
    document.getElementById('modal-singer').classList.add('hidden');
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: pendingSongQueueId, singerName: name })
      });
      const data = await res.json();
      if (data.success) {
        loadQueue();
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error('Error adding to queue:', err);
    }
  };

  btnAdd.addEventListener('click', submitSinger);
  inputSinger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitSinger();
    }
  });

  document.getElementById('btn-modal-verify-admin').addEventListener('click', verifyAdminPassword);
  document.getElementById('btn-verify-admin').addEventListener('click', () => {
    const password = document.getElementById('admin-password-input').value;
    verifyAdminPasswordDirect(password);
  });

  // Settings Events
  const btnBrowseLibrary = document.getElementById('btn-browse-library');
  if (btnBrowseLibrary) {
    btnBrowseLibrary.addEventListener('click', handleBrowseLibrary);
  }
  document.getElementById('btn-rescan-library').addEventListener('click', rescanLibrary);
  document.getElementById('btn-restart-server').addEventListener('click', saveSettings);
  
  // Save when library path is typed or modified
  settingsLibraryPath.addEventListener('change', () => {
    saveSettings();
  });
  settingsLibraryPath.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveSettings().then(() => rescanLibrary());
    }
  });

  settingsVolume.addEventListener('input', (e) => {
    settingsVolumeLabel.textContent = `${e.target.value}%`;
    footerVolumeSlider.value = e.target.value;
    updateVolume(e.target.value);
  });
  settingsVolume.addEventListener('change', saveSettings);

  footerVolumeSlider.addEventListener('input', (e) => {
    settingsVolume.value = e.target.value;
    settingsVolumeLabel.textContent = `${e.target.value}%`;
    updateVolume(e.target.value);
  });
  footerVolumeSlider.addEventListener('change', saveSettings);

  // Save on input change for performance settings
  settingsFullscreen.addEventListener('change', saveSettings);
  settingsHardware.addEventListener('change', saveSettings);

  // Playback Control Buttons (Dashboard)
  document.getElementById('btn-player-toggle').addEventListener('click', togglePlayPause);
  document.getElementById('btn-player-restart').addEventListener('click', restartSong);
  document.getElementById('btn-player-skip').addEventListener('click', skipSong);
  document.getElementById('btn-fullscreen-toggle').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-home-video-shortcut').addEventListener('click', toggleFullscreen);

  // Projector Control Button
  document.getElementById('btn-toggle-projector').addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.getProjectorStatus().then(isOpen => {
        if (isOpen) {
          window.electronAPI.closeProjector();
        } else {
          window.electronAPI.openProjector();
        }
      });
    }
  });

  // Videoke Remote Permissions Setting Toggle
  const userRemoteToggle = document.getElementById('settings-user-remote-input');
  if (userRemoteToggle) {
    userRemoteToggle.addEventListener('change', () => {
      saveSettings();
    });
  }

  // Print Songbook Modal Listeners
  const btnPrintSongbook = document.getElementById('btn-print-songbook');
  if (btnPrintSongbook) {
    btnPrintSongbook.addEventListener('click', openPrintSongbookModal);
  }

  const btnClosePrintModal = document.getElementById('btn-close-print-modal');
  if (btnClosePrintModal) {
    btnClosePrintModal.addEventListener('click', () => {
      document.getElementById('modal-print-songbook').classList.add('hidden');
    });
  }

  const btnExecutePrint = document.getElementById('btn-execute-print');
  if (btnExecutePrint) {
    btnExecutePrint.addEventListener('click', executePrintSongbook);
  }

  const printSortBy = document.getElementById('print-sort-by');
  if (printSortBy) {
    printSortBy.addEventListener('change', renderPrintSongbookPreview);
  }

  const printCatFilter = document.getElementById('print-category-filter');
  if (printCatFilter) {
    printCatFilter.addEventListener('change', renderPrintSongbookPreview);
  }

  // Desktop Remote Modal Listeners
  const btnOpenRemoteModal = document.getElementById('btn-open-remote-modal');
  if (btnOpenRemoteModal) {
    btnOpenRemoteModal.addEventListener('click', openDesktopRemoteModal);
  }

  const btnCloseRemoteModal = document.getElementById('btn-close-remote-modal');
  if (btnCloseRemoteModal) {
    btnCloseRemoteModal.addEventListener('click', () => {
      document.getElementById('modal-desktop-remote').classList.add('hidden');
    });
  }

  const btnDesktopRemoteClear = document.getElementById('btn-desktop-remote-clear');
  if (btnDesktopRemoteClear) {
    btnDesktopRemoteClear.addEventListener('click', clearDesktopRemoteInput);
  }

  const btnDesktopRemoteEnter = document.getElementById('btn-desktop-remote-enter');
  if (btnDesktopRemoteEnter) {
    btnDesktopRemoteEnter.addEventListener('click', submitDesktopRemoteInput);
  }

  document.querySelectorAll('.dt-key').forEach(btn => {
    btn.addEventListener('click', () => {
      pressDesktopRemoteDigit(btn.getAttribute('data-val'));
    });
  });
}

// --- UI Navigation Controllers ---
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update sidebar active classes
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.className = 'nav-item flex items-center gap-3 px-4 py-3 rounded-xl text-primary font-bold bg-primary/10 transition-all';
    } else {
      item.className = 'nav-item flex items-center gap-3 px-4 py-3 rounded-xl text-on-surface-variant font-medium hover:bg-surface-variant/50 transition-all';
    }
  });

  // Update visible pane
  document.querySelectorAll('.view-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  
  const targetPane = document.getElementById(`pane-${tabName}`);
  if (targetPane) targetPane.classList.add('active');

  // Trigger loading relevant content
  if (tabName === 'songbook') {
    loadAllSongs();
  } else if (tabName === 'queue') {
    loadQueue();
  } else if (tabName === 'home') {
    loadRecentHistory();
  }
}

// --- Database & API Helpers ---
async function loadAllSongs(query = '', category = '') {
  try {
    let url = `/api/songs?q=${encodeURIComponent(query)}`;
    if (category) {
      url += `&category=${encodeURIComponent(category)}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      songsList = data.songs;
      renderSongbook();
    }
  } catch (err) {
    console.error('Error loading songs:', err);
  }
}

async function loadQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    if (data.success) {
      updateQueueUI(data.queue, data.nowPlaying);
    }
  } catch (err) {
    console.error('Error loading queue:', err);
  }
}

async function loadRecentHistory() {
  try {
    const res = await fetch('/api/songs?category=Recently Played');
    const data = await res.json();
    if (data.success) {
      renderRecentSongs(data.songs);
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function filterSongbookCategory(cat) {
  loadAllSongs('', cat);
}

// --- Render Templates ---
function renderSongbook() {
  songbookCount.textContent = `Browse over ${songsList.length} indexed karaoke tracks`;
  if (settingsSongCount) {
    settingsSongCount.textContent = `${songsList.length} songs indexed`;
  }
  songbookGrid.innerHTML = '';

  if (songsList.length === 0) {
    songbookGrid.innerHTML = `
      <div class="col-span-full py-16 text-center text-on-surface-variant flex flex-col items-center">
        <span class="material-symbols-outlined text-5xl mb-3 text-primary/60">library_music</span>
        <h4 class="text-base font-bold text-on-surface mb-1">No songs found in the library</h4>
        <p class="text-xs text-on-surface-variant max-w-md mb-5">Configure your karaoke video folder in Settings to start indexing and playing your songs.</p>
        <button id="btn-empty-configure-library" class="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary-container active:scale-95 transition-all flex items-center gap-2 shadow-lg shadow-primary/20">
          <span class="material-symbols-outlined text-sm">folder_open</span>
          <span>Configure Library Path</span>
        </button>
      </div>
    `;
    const btnEmptyConfig = document.getElementById('btn-empty-configure-library');
    if (btnEmptyConfig) {
      btnEmptyConfig.addEventListener('click', () => switchTab('settings'));
    }
    return;
  }

  songsList.forEach(song => {
    const card = document.createElement('div');
    card.className = 'group relative overflow-hidden rounded-2xl bg-surface-container transition-all hover:bg-surface-container-high border border-outline-variant/10 p-5 flex flex-col justify-between';
    card.innerHTML = `
      <div>
        <div class="w-full aspect-square rounded-xl bg-surface-container-highest mb-3 overflow-hidden relative flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-all">
          <span class="material-symbols-outlined text-4xl group-hover:scale-110 transition-transform">music_note</span>
        </div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="px-2.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-md font-mono font-black text-xs shadow-sm">
            #${song.song_number || song.id}
          </span>
          <span class="px-2 py-0.5 bg-surface-container-highest text-[10px] font-semibold text-on-surface-variant rounded">
            ${song.category || 'Pop'}
          </span>
        </div>
        <h4 class="font-bold text-on-surface truncate text-sm mb-0.5" title="${song.title}">${song.title}</h4>
        <p class="text-on-surface-variant text-xs truncate mb-3">${song.artist}</p>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-white/5">
        <span class="text-[10px] text-on-surface-variant/70 font-mono">Videoke #${song.song_number || song.id}</span>
        <button class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow hover:scale-105 active:scale-95 transition-transform" onclick="promptAddToQueue(${song.id})">
          <span class="material-symbols-outlined text-md font-bold">add</span>
        </button>
      </div>
    `;
    songbookGrid.appendChild(card);
  });
}

function renderRecentSongs(songs) {
  homeRecentSongs.innerHTML = '';
  if (!songs || songs.length === 0) {
    homeRecentSongs.innerHTML = `
      <p class="text-sm text-on-surface-variant col-span-full">No songs played yet. Sing the first one!</p>
    `;
    return;
  }

  songs.slice(0, 5).forEach(song => {
    const el = document.createElement('div');
    el.className = 'group cursor-pointer'
    el.onclick = () => promptAddToQueue(song.id);
    el.innerHTML = `
      <div class="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-surface-container-highest flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-all">
        <span class="material-symbols-outlined text-4xl group-hover:scale-110 transition-transform">music_note</span>
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span class="material-symbols-outlined text-white text-3xl">add_circle</span>
        </div>
      </div>
      <h4 class="font-bold text-sm truncate" title="${song.title}">${song.title}</h4>
      <p class="text-on-surface-variant text-xs truncate">${song.artist}</p>
    `;
    homeRecentSongs.appendChild(el);
  });
}

let pendingSongQueueId = null;

function promptAddToQueue(songId) {
  pendingSongQueueId = songId;
  const modalSinger = document.getElementById('modal-singer');
  const input = document.getElementById('modal-singer-name-input');
  input.value = 'Guest';
  modalSinger.classList.remove('hidden');
  input.focus();
  input.select();
}

// Global scope expose for inline onclick attributes
window.promptAddToQueue = promptAddToQueue;

function updateQueueUI(queue, current) {
  queueList = queue;
  nowPlaying = current;
  
  // Update badge count
  const waitlistCount = queue.filter(item => item.status !== 'singing').length;
  if (waitlistCount > 0) {
    queueBadge.textContent = waitlistCount;
    queueBadge.classList.remove('hidden');
  } else {
    queueBadge.classList.add('hidden');
  }

  // Update counters
  queueCountText.textContent = `${waitlistCount} songs`;
  queueTimeEst.textContent = `${waitlistCount * 4} mins`;

  // Render Queue Lists (Dashboard View)
  queueListContainer.innerHTML = '';
  const pendingSongs = queue.filter(item => item.status !== 'singing');
  
  if (pendingSongs.length === 0) {
    queueListContainer.innerHTML = `
      <div class="py-12 border-2 border-dashed border-outline-variant/20 rounded-3xl flex flex-col items-center justify-center text-on-surface-variant cursor-pointer hover:border-primary/40 hover:bg-surface-container-low/30 transition-all" onclick="switchTab('songbook')">
        <span class="material-symbols-outlined text-3xl mb-2 text-primary">add</span>
        <p class="text-sm font-semibold">Queue is empty</p>
        <p class="text-xs">Browse songbook or search to add songs</p>
      </div>
    `;
  } else {
    pendingSongs.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'glass-panel p-4 rounded-2xl flex items-center gap-4 group hover:border-primary/30 transition-all';
      
      let actionButtons = '';
      
      if (isAdminVerified) {
        actionButtons = `
          <button class="p-1 text-on-surface-variant hover:text-primary transition-all" onclick="bumpSongOrder(${item.queue_id})"><span class="material-symbols-outlined text-md">arrow_upward</span></button>
          <button class="p-1 text-on-surface-variant hover:text-status-error transition-all" onclick="removeQueueItem(${item.queue_id})"><span class="material-symbols-outlined text-md">close</span></button>
        `;
      }

      el.innerHTML = `
        <div class="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant font-bold text-xs select-none">
          ${index + 1}
        </div>
        <div class="flex-grow min-w-0">
          <h4 class="font-bold text-sm truncate">${item.title}</h4>
          <p class="text-xs text-on-surface-variant truncate">${item.artist} &bull; Singer: <span class="text-primary font-semibold">${item.singer_name}</span></p>
        </div>
        <div class="flex items-center gap-2">
          ${actionButtons}
        </div>
      `;
      queueListContainer.appendChild(el);
    });
  }

  // Update Now Playing Info
  if (nowPlaying) {
    npTitle.textContent = nowPlaying.title;
    npArtist.textContent = nowPlaying.artist;
    npSinger.textContent = `Singer: ${nowPlaying.singer_name}`;
    
    footerSongTitle.textContent = nowPlaying.title;
    footerSingerName.textContent = nowPlaying.singer_name;
    
    // Send video loading message to projector
    const videoUrl = `${apiBaseUrl}/media/${encodePath(nowPlaying.file_path)}`;
    if (currentVideoPath !== nowPlaying.file_path) {
      currentVideoPath = nowPlaying.file_path;
      if (window.electronAPI) {
        window.electronAPI.sendToProjector('projector-load', {
          src: videoUrl,
          title: nowPlaying.title,
          artist: nowPlaying.artist,
          singer: nowPlaying.singer_name,
          songNumber: nowPlaying.song_number
        });
      }
    }
  } else {
    npTitle.textContent = 'No Song Playing';
    npArtist.textContent = 'Select a song from the library';
    npSinger.textContent = 'Singer: --';
    
    footerSongTitle.textContent = 'No Song Playing';
    footerSingerName.textContent = '--';
    
    currentVideoPath = '';
    if (window.electronAPI) {
      window.electronAPI.sendToProjector('projector-load', {
        src: null,
        title: '--',
        artist: '--',
        singer: '--',
        songNumber: null
      });
    }
  }

  // Always keep projector up next / waitlist updated
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-queue', { queue: queueList });
  }

  // Forward waitlist queue to projector window
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-queue', { queue: queue });
  }
}

// Admin queue controllers
async function bumpSongOrder(queueId) {
  // Move item up in sort order
  const index = queueList.findIndex(item => item.queue_id === queueId);
  if (index <= 0) return;
  if (index === 1 && queueList[0].status === 'singing') return; // Cannot bump first pending song above currently singing song

  const targetItem = queueList[index];
  const upperItem = queueList[index - 1];

  // Swap sort orders
  const updates = [
    { queue_id: targetItem.queue_id, sort_order: upperItem.sort_order },
    { queue_id: upperItem.queue_id, sort_order: targetItem.sort_order }
  ];

  try {
    const res = await fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: updates })
    });
    const data = await res.json();
    if (data.success) {
      loadQueue();
    } else {
      console.error('Failed to reorder queue:', data.error);
    }
  } catch (err) {
    console.error('Error bumping song order:', err);
  }
}

// Let's expose admin controls locally in renderer
async function removeQueueItem(queueId) {
  try {
    const res = await fetch(`/api/queue/${queueId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadQueue();
    }
  } catch (err) {
    console.error(err);
  }
}
window.removeQueueItem = removeQueueItem;

async function clearAllQueue() {
  if (!confirm('Are you sure you want to clear all upcoming songs in the queue?')) return;
  try {
    const res = await fetch('/api/queue/clear', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadQueue();
    }
  } catch (err) {
    console.error(err);
  }
}
document.getElementById('btn-clear-queue').addEventListener('click', () => {
  if (!isAdminVerified) {
    modalAdmin.classList.remove('hidden');
    return;
  }
  clearAllQueue();
});

// --- Settings Management ---
async function handleBrowseLibrary() {
  if (window.electronAPI && window.electronAPI.selectDirectory) {
    try {
      const selectedPath = await window.electronAPI.selectDirectory();
      if (selectedPath) {
        settingsLibraryPath.value = selectedPath;
        await saveSettings();
        await rescanLibrary();
      }
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  } else {
    const currentVal = settingsLibraryPath.value || '';
    const manualPath = prompt('Enter the absolute path to your karaoke video directory:', currentVal);
    if (manualPath && manualPath.trim()) {
      settingsLibraryPath.value = manualPath.trim();
      await saveSettings();
      await rescanLibrary();
    }
  }
}

function updateSettingsUI(settings) {
  if (!settings) return;
  settingsPort.value = settings.serverPort || 8080;
  settingsLibraryPath.value = settings.libraryPath || '';
  settingsVolume.value = settings.masterVolume !== undefined ? settings.masterVolume : 85;
  settingsVolumeLabel.textContent = `${settingsVolume.value}%`;
  footerVolumeSlider.value = settingsVolume.value;
  settingsFullscreen.checked = !!settings.fullscreen;
  settingsHardware.checked = !!settings.hardwareAcceleration;

  const autoStartTunnelEl = document.getElementById('settings-autostart-tunnel');
  if (autoStartTunnelEl) {
    autoStartTunnelEl.checked = !!settings.autoStartTunnel;
  }

  // Update user remote input toggle and notice
  const userRemoteInputEl = document.getElementById('settings-user-remote-input');
  const remoteNotice = document.getElementById('remote-input-status-notice');
  const remoteText = document.getElementById('remote-input-status-text');
  if (userRemoteInputEl) {
    const isEnabled = settings.userRemoteInputEnabled !== false;
    userRemoteInputEl.checked = isEnabled;
    if (remoteNotice && remoteText) {
      if (isEnabled) {
        remoteNotice.className = 'p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-[10px] text-primary font-bold flex items-center gap-2';
        remoteNotice.innerHTML = `
          <span class="material-symbols-outlined text-sm">lock_open</span>
          <span>Singers CAN input songs via mobile remote</span>
        `;
      } else {
        remoteNotice.className = 'p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-400 font-bold flex items-center gap-2';
        remoteNotice.innerHTML = `
          <span class="material-symbols-outlined text-sm">lock</span>
          <span>LOCKED: Only ADMIN can input songs via remote</span>
        `;
      }
    }
  }
  
  // Set volume of video tag
  updateVolume(settingsVolume.value);
}

async function saveSettings() {
  const autoStartTunnelEl = document.getElementById('settings-autostart-tunnel');
  const userRemoteInputEl = document.getElementById('settings-user-remote-input');
  const newSettings = {
    libraryPath: settingsLibraryPath.value.trim(),
    serverPort: parseInt(settingsPort.value) || 8080,
    theme: systemSettings ? systemSettings.theme : 'Midnight (Dark)',
    ambientVisualizer: systemSettings ? systemSettings.ambientVisualizer : 'Neon Pulse (Default)',
    masterVolume: parseInt(settingsVolume.value) || 85,
    adminPassword: systemSettings ? systemSettings.adminPassword : 'admin',
    fullscreen: settingsFullscreen.checked,
    hardwareAcceleration: settingsHardware.checked,
    autoStartTunnel: autoStartTunnelEl ? autoStartTunnelEl.checked : false,
    userRemoteInputEnabled: userRemoteInputEl ? userRemoteInputEl.checked : true
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    const data = await res.json();
    if (data.success) {
      systemSettings = data.settings || newSettings;
      console.log('Settings saved successfully.');
      if (data.scanResult) {
        settingsSongCount.textContent = `${data.scanResult.total} songs indexed`;
        loadAllSongs();
      }
      return data;
    }
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

async function rescanLibrary() {
  const btn = document.getElementById('btn-rescan-library');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Scanning...';
  }
  
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      settingsSongCount.textContent = `${data.result.total} songs indexed`;
      alert(`Scan complete!\nAdded: ${data.result.added}\nRemoved: ${data.result.removed}\nTotal Indexed: ${data.result.total}`);
      loadAllSongs();
    } else {
      alert(`Error during scan: ${data.error}`);
    }
  } catch (err) {
    console.error('Error scanning library:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<span class="material-symbols-outlined text-base">sync</span><span>Rescan Library</span>';
    }
  }
}

// --- Player Engine Controllers ---
function updateVolume(val) {
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-volume', val);
  }
}

async function playVideo() {
  if (!nowPlaying) {
    if (queueList.length > 0) {
      try {
        const nextPending = queueList[0];
        await fetch(`/api/queue/singing/${nextPending.queue_id}`, { method: 'POST' });
        loadQueue();
        setTimeout(() => {
          if (window.electronAPI) {
            window.electronAPI.sendToProjector('projector-play');
          }
        }, 500);
      } catch (err) {
        console.error('Failed to start first song in queue:', err);
      }
    }
    return;
  }
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-play');
  }
}

function pauseVideo() {
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-pause');
  }
}

function stopVideo() {
  if (window.electronAPI) {
    window.electronAPI.sendToProjector('projector-stop');
  }
}

async function togglePlayPause() {
  if (!nowPlaying) {
    await playVideo();
    return;
  }
  if (window.electronAPI) {
    window.electronAPI.sendToProjector(isPlaybackActive ? 'projector-pause' : 'projector-play');
  }
}

async function skipSong() {
  if (!nowPlaying) return;
  
  try {
    // Mark current song as finished
    await fetch(`/api/queue/finish/${nowPlaying.queue_id}`, { method: 'POST' });
    
    // Play next song:
    // Query queue to find next pending song
    const res = await fetch('/api/queue');
    const data = await res.json();
    if (data.success && data.queue.length > 0) {
      const nextPending = data.queue[0]; // first song
      // Set to singing
      await fetch(`/api/queue/singing/${nextPending.queue_id}`, { method: 'POST' });
    }
    
    loadQueue();
    // Auto start playing
    setTimeout(() => {
      playVideo();
    }, 500);
  } catch (err) {
    console.error('Error skipping song:', err);
  }
}

function restartSong() {
  if (window.electronAPI && nowPlaying) {
    const videoUrl = `${apiBaseUrl}/media/${encodePath(nowPlaying.file_path)}`;
    window.electronAPI.sendToProjector('projector-load', {
      src: videoUrl,
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      singer: nowPlaying.singer_name
    });
  }
}

function handleVideoEnded() {
  console.log('Video play finished.');
  skipSong();
}

function updatePlaybackProgress(currentTime, duration) {
  if (!duration) return;
  const progress = (currentTime / duration) * 100;
  npProgress.style.width = `${progress}%`;

  // Update timestamps
  const curMin = Math.floor(currentTime / 60).toString().padStart(2, '0');
  const curSec = Math.floor(currentTime % 60).toString().padStart(2, '0');
  const totMin = Math.floor(duration / 60).toString().padStart(2, '0');
  const totSec = Math.floor(duration % 60).toString().padStart(2, '0');

  npTimeCur.textContent = `${curMin}:${curSec}`;
  npTimeTotal.textContent = `${totMin}:${totSec}`;
}

// Fullscreen window toggles - now acts to toggle native fullscreen on projector
function toggleFullscreen() {
  if (window.electronAPI) {
    window.electronAPI.getProjectorStatus().then(isOpen => {
      if (isOpen) {
        window.electronAPI.sendToProjector('projector-toggle-fullscreen');
      } else {
        window.electronAPI.openProjector();
      }
    });
  }
}

// --- Admin Authentication Controllers ---
function verifyAdminPassword() {
  const pwd = modalAdminPassword.value;
  if (systemSettings && pwd === systemSettings.adminPassword) {
    isAdminVerified = true;
    modalAdminPassword.value = '';
    modalAdmin.classList.add('hidden');
    document.getElementById('admin-status-text').textContent = 'Admin Mode';
    document.getElementById('btn-admin-mode').innerHTML = `
      <span class="material-symbols-outlined text-[20px] text-status-error">admin_panel_settings</span>
      <span class="text-status-error font-bold">Exit Admin</span>
    `;
    loadQueue(); // Reload to show actions
  } else {
    alert('Invalid Administrator Password.');
  }
}

function verifyAdminPasswordDirect(pwd) {
  if (systemSettings && pwd === systemSettings.adminPassword) {
    isAdminVerified = true;
    document.getElementById('admin-password-input').value = '';
    document.getElementById('admin-status-text').textContent = 'Admin Mode';
    document.getElementById('btn-admin-mode').innerHTML = `
      <span class="material-symbols-outlined text-[20px] text-status-error">admin_panel_settings</span>
      <span class="text-status-error font-bold">Exit Admin</span>
    `;
    loadQueue();
    alert('Admin Mode Enabled Successfully.');
  } else {
    alert('Invalid Password.');
  }
}

// --- Tunnel & QR Code Helpers ---
let latestTunnelState = { status: 'stopped', url: null, error: null };

function updateTunnelUI(tunnel) {
  if (!tunnel) return;
  latestTunnelState = tunnel;

  const status = tunnel.status; // 'stopped', 'starting', 'running', 'error'
  const url = tunnel.url;

  // Settings Panel UI
  const badge = document.getElementById('settings-tunnel-status-badge');
  const badgeText = document.getElementById('settings-tunnel-status-text');
  const urlBox = document.getElementById('settings-tunnel-url-box');
  const urlText = document.getElementById('settings-tunnel-url-text');
  const toggleBtnText = document.getElementById('btn-toggle-tunnel-settings-text');

  if (status === 'running') {
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5';
    }
    if (badgeText) badgeText.textContent = 'Online';
    if (urlBox) urlBox.classList.remove('hidden');
    if (urlText) urlText.textContent = url || '--';
    if (toggleBtnText) toggleBtnText.textContent = 'Stop Cloudflare Tunnel';
  } else if (status === 'starting') {
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5';
    }
    if (badgeText) badgeText.textContent = 'Connecting...';
    if (urlBox) urlBox.classList.add('hidden');
    if (toggleBtnText) toggleBtnText.textContent = 'Connecting...';
  } else if (status === 'error') {
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1.5';
    }
    if (badgeText) badgeText.textContent = 'Error';
    if (urlBox) urlBox.classList.add('hidden');
    if (toggleBtnText) toggleBtnText.textContent = 'Retry Start Tunnel';
  } else {
    // stopped
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-surface-container text-on-surface-variant flex items-center gap-1.5 border border-white/5';
    }
    if (badgeText) badgeText.textContent = 'Offline';
    if (urlBox) urlBox.classList.add('hidden');
    if (toggleBtnText) toggleBtnText.textContent = 'Start Cloudflare Tunnel';
  }

  // Modal Panes UI
  const viewStopped = document.getElementById('tunnel-view-stopped');
  const viewStarting = document.getElementById('tunnel-view-starting');
  const viewRunning = document.getElementById('tunnel-view-running');
  const viewError = document.getElementById('tunnel-view-error');
  const qrTunnelUrlText = document.getElementById('qr-tunnel-url-text');
  const tunnelErrorMsg = document.getElementById('tunnel-error-msg');

  if (viewStopped) viewStopped.classList.add('hidden');
  if (viewStarting) viewStarting.classList.add('hidden');
  if (viewRunning) viewRunning.classList.add('hidden');
  if (viewError) viewError.classList.add('hidden');

  if (status === 'running') {
    if (viewRunning) viewRunning.classList.remove('hidden');
    if (qrTunnelUrlText && url) qrTunnelUrlText.textContent = url;
  } else if (status === 'starting') {
    if (viewStarting) viewStarting.classList.remove('hidden');
  } else if (status === 'error') {
    if (viewError) viewError.classList.remove('hidden');
    if (tunnelErrorMsg) tunnelErrorMsg.textContent = tunnel.error || 'Connection failed.';
  } else {
    if (viewStopped) viewStopped.classList.remove('hidden');
  }
}

async function startCloudflareTunnel() {
  updateTunnelUI({ status: 'starting' });
  try {
    const res = await fetch('/api/tunnel/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateTunnelUI(data.tunnel);
      generateQrCode();
    } else {
      updateTunnelUI({ status: 'error', error: data.error });
    }
  } catch (err) {
    updateTunnelUI({ status: 'error', error: err.message });
  }
}

async function stopCloudflareTunnel() {
  try {
    const res = await fetch('/api/tunnel/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateTunnelUI(data.tunnel);
      generateQrCode();
    }
  } catch (err) {
    console.error('Error stopping tunnel:', err);
  }
}

async function generateQrCode() {
  try {
    const res = await fetch('/api/qr');
    const data = await res.json();
    if (data.success) {
      // Local QR
      if (data.local) {
        if (qrImage) qrImage.src = data.local.qrCodeDataUrl;
        if (qrUrlText) qrUrlText.textContent = data.local.url;
      } else {
        if (qrImage) qrImage.src = data.qrCodeDataUrl;
        if (qrUrlText) qrUrlText.textContent = data.url;
      }

      // Tunnel QR
      if (data.tunnel) {
        const qrTunnelImage = document.getElementById('qr-tunnel-image');
        const qrTunnelUrlText = document.getElementById('qr-tunnel-url-text');
        if (data.tunnel.qrCodeDataUrl && qrTunnelImage) {
          qrTunnelImage.src = data.tunnel.qrCodeDataUrl;
        }
        if (data.tunnel.url && qrTunnelUrlText) {
          qrTunnelUrlText.textContent = data.tunnel.url;
        }
        updateTunnelUI(data.tunnel);
      }
    }
  } catch (err) {
    console.error('Error loading QR code:', err);
  }
}

// ==========================================
// SONGBOOK PRINTING & PREVIEW
// ==========================================
let printSongbookList = [];

async function openPrintSongbookModal() {
  const modal = document.getElementById('modal-print-songbook');
  if (!modal) return;
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/songs?sortBy=song_number');
    const data = await res.json();
    if (data.success) {
      printSongbookList = data.songs || [];
    } else {
      printSongbookList = [...songsList];
    }
  } catch (e) {
    printSongbookList = [...songsList];
  }

  renderPrintSongbookPreview();
}

function renderPrintSongbookPreview() {
  const previewContainer = document.getElementById('print-preview-container');
  const countEl = document.getElementById('print-preview-count');
  const sortByEl = document.getElementById('print-sort-by');
  const catFilterEl = document.getElementById('print-category-filter');

  const sortBy = sortByEl ? sortByEl.value : 'song_number';
  const catFilter = catFilterEl ? catFilterEl.value : 'All';

  if (!previewContainer) return;

  // Filter songs
  let filtered = [...printSongbookList];
  if (catFilter !== 'All') {
    filtered = filtered.filter(s => (s.category || '').toLowerCase() === catFilter.toLowerCase());
  }

  // Sort songs
  filtered.sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    } else if (sortBy === 'artist') {
      return a.artist.localeCompare(b.artist);
    } else {
      return (a.song_number || 0) - (b.song_number || 0);
    }
  });

  if (countEl) countEl.textContent = `${filtered.length} songs`;

  if (filtered.length === 0) {
    previewContainer.innerHTML = `
      <div class="py-12 text-center text-slate-400">
        <p class="font-bold text-sm">No songs match the selected filter.</p>
      </div>
    `;
    return;
  }

  // Build clean 2-column or 3-column classic karaoke songbook layout
  const rowsHtml = filtered.map(song => `
    <div class="flex items-center justify-between p-2 rounded border border-slate-100 hover:bg-slate-50 transition-colors">
      <div class="flex items-center gap-3 min-w-0">
        <span class="font-mono font-black text-sm text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex-shrink-0">
          ${String(song.song_number || song.id).padStart(5, '0')}
        </span>
        <div class="min-w-0">
          <p class="font-bold text-xs text-slate-900 truncate leading-tight">${escapeHtml(song.title)}</p>
          <p class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHtml(song.artist)}</p>
        </div>
      </div>
      <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 rounded ml-2 flex-shrink-0">
        ${escapeHtml(song.category || 'Pop')}
      </span>
    </div>
  `).join('');

  previewContainer.innerHTML = `
    <div class="space-y-4">
      <div class="border-b-2 border-slate-900 pb-3 flex items-center justify-between">
        <div>
          <h1 class="font-black text-2xl tracking-tighter text-slate-900 uppercase">KANTA-BAI OFFICIAL SONGBOOK</h1>
          <p class="text-xs text-slate-500 font-medium">Standard 5-Digit Karaoke Selection Directory &bull; Sorted by: ${sortBy.replace('_', ' ').toUpperCase()}</p>
        </div>
        <div class="text-right">
          <span class="inline-block px-3 py-1 rounded bg-emerald-600 text-white font-mono font-bold text-xs">TOTAL: ${filtered.length} TRACKS</span>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function executePrintSongbook() {
  const previewContainer = document.getElementById('print-preview-container');
  const printDoc = document.getElementById('print-songbook-document');
  if (!previewContainer || !printDoc) return;

  // Clone preview container into print container
  printDoc.innerHTML = previewContainer.innerHTML;
  printDoc.classList.remove('hidden');

  // Trigger browser print
  setTimeout(() => {
    window.print();
    printDoc.classList.add('hidden');
  }, 250);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// DESKTOP NOSTALGIC REMOTE KEYPAD & VOICE
// ==========================================
let desktopRemoteCode = '';
let audioCtx = null;
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function playBeepTone(freq = 750) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.09, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch (e) {}
}

// Pre-load authentic Platinum Karaoke voice clips (0-9)
const desktopPlatinumVoiceAudios = {};
for (let i = 0; i <= 9; i++) {
  const audio = new Audio(`audio/digit_${i}.mp3`);
  audio.preload = 'auto';
  desktopPlatinumVoiceAudios[i] = audio;
}

function playDesktopPlatinumDigitVoice(digit) {
  const toggle = document.getElementById('desktop-voice-toggle');
  if (toggle && !toggle.checked) return;
  const num = parseInt(digit, 10);
  if (isNaN(num) || num < 0 || num > 9) return;

  try {
    const audio = desktopPlatinumVoiceAudios[num] || new Audio(`audio/digit_${num}.mp3`);
    audio.currentTime = 0;
    const p = audio.play();
    if (p !== undefined) {
      p.catch(() => {
        speakVoice(NUMBER_WORDS[num] || digit);
      });
    }
  } catch (e) {
    speakVoice(NUMBER_WORDS[num] || digit);
  }
}

function speakVoice(text) {
  if (!('speechSynthesis' in window)) return;
  const toggle = document.getElementById('desktop-voice-toggle');
  if (toggle && !toggle.checked) return;

  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.15;
    utter.pitch = 1.0;
    utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function openDesktopRemoteModal() {
  const modal = document.getElementById('modal-desktop-remote');
  if (!modal) return;
  modal.classList.remove('hidden');
  clearDesktopRemoteInput();
}

function updateDesktopRemoteDisplay() {
  const display = document.getElementById('desktop-remote-display');
  const preview = document.getElementById('desktop-remote-song-preview');
  if (!display || !preview) return;

  if (!desktopRemoteCode) {
    display.textContent = '_ _ _ _ _';
    preview.textContent = 'Type 4-5 digit number from Songbook';
    preview.className = 'text-xs text-white/70 font-medium truncate text-center min-h-[1.25rem]';
    return;
  }

  // Format code display with spaces e.g. 1 0 0 0 1
  const chars = desktopRemoteCode.split('');
  while (chars.length < 5) chars.push('_');
  display.textContent = chars.join(' ');

  // Live lookup
  if (desktopRemoteCode.length >= 3) {
    fetch(`/api/songs/by-number/${desktopRemoteCode}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.song) {
          preview.textContent = `${data.song.title} - ${data.song.artist}`;
          preview.className = 'text-xs text-primary font-bold truncate text-center min-h-[1.25rem] animate-pulse';
        } else {
          preview.textContent = `No song found for #${desktopRemoteCode}`;
          preview.className = 'text-xs text-red-400 font-medium truncate text-center min-h-[1.25rem]';
        }
      })
      .catch(() => {
        preview.textContent = `Searching #${desktopRemoteCode}...`;
      });
  } else {
    preview.textContent = `Entering code (${desktopRemoteCode.length}/5)...`;
    preview.className = 'text-xs text-white/70 font-medium truncate text-center min-h-[1.25rem]';
  }
}

function pressDesktopRemoteDigit(digit) {
  const num = parseInt(digit, 10);
  if (isNaN(num)) return;
  if (desktopRemoteCode.length >= 5) return;

  desktopRemoteCode += digit;
  playDesktopPlatinumDigitVoice(num);
  playBeepTone(600 + num * 50);
  updateDesktopRemoteDisplay();
}

function clearDesktopRemoteInput() {
  desktopRemoteCode = '';
  speakVoice('Clear');
  playBeepTone(350);
  updateDesktopRemoteDisplay();
}

async function submitDesktopRemoteInput() {
  if (!desktopRemoteCode) return;

  const singerInput = document.getElementById('desktop-remote-singer-input');
  const singer = (singerInput && singerInput.value.trim()) ? singerInput.value.trim() : 'Host';
  const preview = document.getElementById('desktop-remote-song-preview');

  try {
    const res = await fetch('/api/queue/by-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songNumber: desktopRemoteCode,
        singerName: singer,
        isRemote: false
      })
    });
    const data = await res.json();
    if (data.success) {
      speakVoice('Song Reserved!');
      playBeepTone(900);
      setTimeout(() => playBeepTone(1200), 100);

      if (preview) {
        preview.textContent = `QUEUED: ${data.song.title} (${singer})`;
        preview.className = 'text-xs text-yellow-300 font-extrabold truncate text-center min-h-[1.25rem]';
      }

      desktopRemoteCode = '';
      setTimeout(() => {
        updateDesktopRemoteDisplay();
        const modal = document.getElementById('modal-desktop-remote');
        if (modal) modal.classList.add('hidden');
      }, 1200);
    } else {
      speakVoice('Error');
      playBeepTone(250);
      if (preview) {
        preview.textContent = data.error || 'Failed to queue song';
        preview.className = 'text-xs text-red-400 font-bold truncate text-center min-h-[1.25rem]';
      }
    }
  } catch (err) {
    console.error('Remote queue error:', err);
  }
}
