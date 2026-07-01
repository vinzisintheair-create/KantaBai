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

// Fullscreen Player elements
const fsPlayer = document.getElementById('fullscreen-player');
const videoElement = document.getElementById('video-element');
const fsSongTitle = document.getElementById('fs-song-title');
const fsSongArtist = document.getElementById('fs-song-artist');
const fsSingerName = document.getElementById('fs-singer-name');
const fsQueueGrid = document.getElementById('fs-queue-grid');
const fsQueueCount = document.getElementById('fs-queue-count');
const fsTimeCur = document.getElementById('fs-time-cur');
const fsTimeTotal = document.getElementById('fs-time-total');
const fsProgressBar = document.getElementById('fs-progress-bar');
const fsProgressContainer = document.getElementById('fs-progress-container');
const fsPlayBtnIcon = document.getElementById('fs-play-btn-icon');
const fsIdlePrompt = document.getElementById('fs-idle-prompt');

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
    generateQrCode();
  });

  socket.on('queue_updated', (data) => {
    updateQueueUI(data.queue, data.nowPlaying);
  });

  socket.on('settings_updated', (data) => {
    systemSettings = data.settings;
    updateSettingsUI(data.settings);
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
    }
  });
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
  });
  document.getElementById('btn-header-qr').addEventListener('click', () => {
    modalQr.classList.remove('hidden');
  });
  document.getElementById('btn-close-qr').addEventListener('click', () => {
    modalQr.classList.add('hidden');
  });

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
  document.getElementById('btn-rescan-library').addEventListener('click', rescanLibrary);
  document.getElementById('btn-restart-server').addEventListener('click', saveSettings);
  settingsVolume.addEventListener('input', (e) => {
    settingsVolumeLabel.textContent = `${e.target.value}%`;
    footerVolumeSlider.value = e.target.value;
    updateVolume(e.target.value);
  });
  footerVolumeSlider.addEventListener('input', (e) => {
    settingsVolume.value = e.target.value;
    settingsVolumeLabel.textContent = `${e.target.value}%`;
    updateVolume(e.target.value);
  });

  // Save on input change for performance settings
  settingsFullscreen.addEventListener('change', saveSettings);
  settingsHardware.addEventListener('change', saveSettings);

  // Playback Control Buttons (Dashboard)
  document.getElementById('btn-player-toggle').addEventListener('click', togglePlayPause);
  document.getElementById('btn-player-restart').addEventListener('click', restartSong);
  document.getElementById('btn-player-skip').addEventListener('click', skipSong);
  document.getElementById('btn-fullscreen-toggle').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-home-video-shortcut').addEventListener('click', toggleFullscreen);

  // Playback Control Buttons (Fullscreen)
  document.getElementById('btn-fs-toggle').addEventListener('click', togglePlayPause);
  document.getElementById('btn-fs-restart').addEventListener('click', restartSong);
  document.getElementById('btn-fs-skip').addEventListener('click', skipSong);
  document.getElementById('btn-fs-exit').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-fs-qr').addEventListener('click', () => {
    modalQr.classList.remove('hidden');
  });

  // Fullscreen player progress seeker click
  fsProgressContainer.addEventListener('click', (e) => {
    const rect = fsProgressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    videoElement.currentTime = pos * videoElement.duration;
  });

  // Idle detection for hiding controls in Fullscreen Player
  fsPlayer.addEventListener('mousemove', resetIdleTimer);
  fsPlayer.addEventListener('click', resetIdleTimer);

  // Video playback end event
  videoElement.addEventListener('ended', handleVideoEnded);
  videoElement.addEventListener('timeupdate', updatePlaybackProgress);
  videoElement.addEventListener('play', () => {
    footerPlayBtnIcon.textContent = 'pause';
    fsPlayBtnIcon.textContent = 'pause';
    footerPlaybackIcon.classList.add('animate-spin');
  });
  videoElement.addEventListener('pause', () => {
    footerPlayBtnIcon.textContent = 'play_arrow';
    fsPlayBtnIcon.textContent = 'play_arrow';
    footerPlaybackIcon.classList.remove('animate-spin');
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
  songbookGrid.innerHTML = '';

  if (songsList.length === 0) {
    songbookGrid.innerHTML = `
      <div class="col-span-full py-16 text-center text-on-surface-variant">
        <span class="material-symbols-outlined text-4xl mb-2">library_music</span>
        <p class="text-sm">No songs found in the library. Go to Settings to configure path and index your files.</p>
      </div>
    `;
    return;
  }

  songsList.forEach(song => {
    const card = document.createElement('div');
    card.className = 'group relative overflow-hidden rounded-2xl bg-surface-container transition-all hover:bg-surface-container-high border border-outline-variant/10 p-5 flex flex-col justify-between';
    card.innerHTML = `
      <div>
        <div class="w-full aspect-square rounded-xl bg-surface-container-highest mb-4 overflow-hidden relative flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-all">
          <span class="material-symbols-outlined text-4xl group-hover:scale-110 transition-transform">music_note</span>
        </div>
        <h4 class="font-bold text-on-surface truncate text-sm mb-0.5" title="${song.title}">${song.title}</h4>
        <p class="text-on-surface-variant text-xs truncate mb-4">${song.artist}</p>
      </div>
      <div class="flex items-center justify-between">
        <span class="px-2 py-0.5 bg-surface-container-highest text-[10px] font-semibold text-on-surface-variant rounded">${song.category || 'Pop'}</span>
        <button class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow hover:scale-105 active:scale-95 transition-transform" onclick="promptAddToQueue(${song.id})">
          <span class="material-symbols-outlined text-md">add</span>
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
      
      let dragHandle = '';
      let actionButtons = '';
      
      if (isAdminVerified) {
        dragHandle = `<div class="cursor-grab text-on-surface-variant/40 hover:text-on-surface"><span class="material-symbols-outlined">drag_indicator</span></div>`;
        actionButtons = `
          <button class="p-1 text-on-surface-variant hover:text-primary transition-all" onclick="bumpSongOrder(${item.queue_id})"><span class="material-symbols-outlined text-md">arrow_upward</span></button>
          <button class="p-1 text-on-surface-variant hover:text-status-error transition-all" onclick="removeQueueItem(${item.queue_id})"><span class="material-symbols-outlined text-md">close</span></button>
        `;
      }

      el.innerHTML = `
        ${dragHandle}
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
    
    // Set video src if changed
    const videoUrl = `${apiBaseUrl}/media/${nowPlaying.file_path}`;
    if (videoElement.src.indexOf(encodeURI(nowPlaying.file_path)) === -1) {
      videoElement.src = videoUrl;
      videoElement.load();
      videoElement.play().catch(console.error);
    }



    fsSongTitle.textContent = nowPlaying.title;
    fsSongArtist.textContent = nowPlaying.artist;
    fsSingerName.textContent = nowPlaying.singer_name;
    fsIdlePrompt.classList.add('hidden');
  } else {
    npTitle.textContent = 'No Song Playing';
    npArtist.textContent = 'Select a song from the library';
    npSinger.textContent = 'Singer: --';
    
    footerSongTitle.textContent = 'No Song Playing';
    footerSingerName.textContent = '--';
    
    videoElement.src = '';
    fsSongTitle.textContent = '--';
    fsSongArtist.textContent = '--';
    fsSingerName.textContent = '--';
    fsIdlePrompt.classList.remove('hidden');
  }

  // Render Fullscreen next 4 queue preview
  fsQueueCount.textContent = `${waitlistCount} songs in waitlist`;
  fsQueueGrid.innerHTML = '';
  if (pendingSongs.length === 0) {
    fsQueueGrid.innerHTML = `
      <div class="bg-white/5 p-3 rounded-xl flex items-center justify-center border border-white/5 text-xs text-on-surface-variant font-medium col-span-4 h-16">
        No upcoming songs in the queue
      </div>
    `;
  } else {
    pendingSongs.slice(0, 4).forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'bg-white/5 hover:bg-white/10 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/5 min-w-0';
      card.innerHTML = `
        <div class="flex-shrink-0 w-8 h-8 rounded-full ${index === 0 ? 'bg-primary/20 text-primary' : 'bg-white/10 text-on-surface-variant'} flex items-center justify-center font-bold text-xs">
          ${index + 1}
        </div>
        <div class="min-w-0 flex-grow">
          <p class="font-bold text-xs text-white truncate leading-tight">${item.title}</p>
          <p class="text-[10px] text-on-surface-variant truncate mt-0.5">${item.artist} &bull; <span class="text-primary font-medium">${item.singer_name}</span></p>
        </div>
      `;
      fsQueueGrid.appendChild(card);
    });
  }
}

// Admin queue controllers
async function bumpSongOrder(queueId) {
  // Move item up in sort order
  const index = queueList.findIndex(item => item.queue_id === queueId);
  if (index <= 1) return; // Already first pending or active

  const targetItem = queueList[index];
  const upperItem = queueList[index - 1];

  // Swap sort orders
  const updates = [
    { queue_id: targetItem.queue_id, sort_order: upperItem.sort_order },
    { queue_id: upperItem.queue_id, sort_order: targetItem.sort_order }
  ];

  try {
    const res = await fetch('/api/settings', { // Wait, do we have reorder endpoint? We added updateQueueOrder in db.js. Let's make an API endpoint for reorder!
      // Wait, we didn't add the /api/queue/reorder route explicitly in server.js!
      // Let's modify server.js if needed, or we can just send it via socket. Let's send a post request to /api/queue/reorder!
      // Let's check how we can do this.
      // Ah! We can easily call fetch to /api/queue/reorder or wait!
      // Let's check: did we add it in server.js? No, we had getQueue, addToQueue.
      // Let's write a route for reordering in server.js or implement it dynamically.
      // Actually, let's write a request to `/api/queue/reorder` which we will implement, or edit server.js to add it!
      // Let's check. Yes, let's edit server.js to add `/api/queue/reorder` and `/api/queue/delete` endpoints!
    });
  } catch (err) {
    console.error(err);
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
function updateSettingsUI(settings) {
  settingsPort.value = settings.serverPort;
  settingsLibraryPath.value = settings.libraryPath;
  settingsVolume.value = settings.masterVolume;
  settingsVolumeLabel.textContent = `${settings.masterVolume}%`;
  footerVolumeSlider.value = settings.masterVolume;
  settingsFullscreen.checked = settings.fullscreen;
  settingsHardware.checked = settings.hardwareAcceleration;
  
  // Set volume of video tag
  updateVolume(settings.masterVolume);
}

async function saveSettings() {
  const newSettings = {
    libraryPath: settingsLibraryPath.value.trim(),
    serverPort: parseInt(settingsPort.value) || 8080,
    theme: systemSettings ? systemSettings.theme : 'Midnight (Dark)',
    ambientVisualizer: systemSettings ? systemSettings.ambientVisualizer : 'Neon Pulse (Default)',
    masterVolume: parseInt(settingsVolume.value),
    adminPassword: systemSettings ? systemSettings.adminPassword : 'admin',
    fullscreen: settingsFullscreen.checked,
    hardwareAcceleration: settingsHardware.checked
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    const data = await res.json();
    if (data.success) {
      systemSettings = newSettings;
      console.log('Settings saved successfully.');
    }
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

async function rescanLibrary() {
  const btn = document.getElementById('btn-rescan-library');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Scanning...';
  
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
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-sm">folder_open</span> Rescan Library';
  }
}

// --- Player Engine Controllers ---
function updateVolume(val) {
  const fraction = val / 100;
  videoElement.volume = fraction;
}

function playVideo() {
  if (videoElement.src && videoElement.src !== window.location.href) {
    videoElement.play().catch(console.error);
  }
}

function pauseVideo() {
  videoElement.pause();
}

function togglePlayPause() {
  if (videoElement.paused) {
    playVideo();
  } else {
    pauseVideo();
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
  videoElement.currentTime = 0;
  playVideo();
}

function handleVideoEnded() {
  console.log('Video play finished.');
  skipSong();
}

function updatePlaybackProgress() {
  if (!videoElement.duration) return;
  const progress = (videoElement.currentTime / videoElement.duration) * 100;
  npProgress.style.width = `${progress}%`;
  fsProgressBar.style.width = `${progress}%`;

  // Update timestamps
  const curMin = Math.floor(videoElement.currentTime / 60).toString().padStart(2, '0');
  const curSec = Math.floor(videoElement.currentTime % 60).toString().padStart(2, '0');
  const totMin = Math.floor(videoElement.duration / 60).toString().padStart(2, '0');
  const totSec = Math.floor(videoElement.duration % 60).toString().padStart(2, '0');

  npTimeCur.textContent = `${curMin}:${curSec}`;
  npTimeTotal.textContent = `${totMin}:${totSec}`;
  fsTimeCur.textContent = `${curMin}:${curSec}`;
  fsTimeTotal.textContent = `${totMin}:${totSec}`;
}

// Fullscreen window toggles
function toggleFullscreen() {
  if (fsPlayer.classList.contains('hidden')) {
    fsPlayer.classList.remove('hidden');
    if (systemSettings && systemSettings.fullscreen) {
      // Toggle native window fullscreen
      window.electronAPI?.setFullscreen(true);
    }
    playVideo();
  } else {
    fsPlayer.classList.add('hidden');
    if (systemSettings && systemSettings.fullscreen) {
      window.electronAPI?.setFullscreen(false);
    }
  }
}

// Controls visibility idle timeout (Fullscreen mode)
function resetIdleTimer() {
  fsPlayer.classList.remove('idle');
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    if (!videoElement.paused) {
      fsPlayer.classList.add('idle');
    }
  }, 3000);
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

// --- QR Code Helper ---
async function generateQrCode() {
  try {
    // Request QR payload from local server
    const res = await fetch('/api/qr');
    const data = await res.json();
    if (data.success) {
      qrImage.src = data.qrCodeDataUrl;
      qrUrlText.textContent = data.url;
    }
  } catch (err) {
    console.error('Error loading QR code:', err);
  }
}
