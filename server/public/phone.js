const socket = io();

// State variables
let activeTab = 'remote';
let songs = [];
let queue = [];
let nowPlaying = null;
let currentCategory = 'All Songs';
let selectedSongId = null;
let isAdmin = sessionStorage.getItem('isAdmin') === 'true';
let userRemoteInputEnabled = true;
let remoteCode = '';
let audioCtx = null;
const DIGIT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

// DOM Elements
const tabRemote = document.getElementById('tab-btn-remote');
const tabBrowse = document.getElementById('tab-btn-browse');
const tabQueue = document.getElementById('tab-btn-queue');
const tabDownload = document.getElementById('tab-btn-download');

const viewRemote = document.getElementById('view-remote');
const viewBrowse = document.getElementById('view-browse');
const viewQueue = document.getElementById('view-queue');
const viewDownload = document.getElementById('view-download');

const searchInput = document.getElementById('search-input');
const categoriesBar = document.getElementById('categories-bar');
const songsList = document.getElementById('songs-list');
const queueList = document.getElementById('queue-list');

// Remote Elements
const remoteLcdNumbers = document.getElementById('remote-lcd-numbers');
const remoteMatchedSongBox = document.getElementById('remote-matched-song-box');
const remoteSingerName = document.getElementById('remote-singer-name');
const btnRemoteClear = document.getElementById('btn-remote-clear');
const btnRemoteEnter = document.getElementById('btn-remote-enter');
const remoteLockoutCard = document.getElementById('remote-lockout-card');
const remoteActivePanel = document.getElementById('remote-active-panel');
const mobileVoiceToggle = document.getElementById('mobile-voice-toggle');
const btnRemoteAuthAdmin = document.getElementById('btn-remote-auth-admin');
const remoteFeedbackToast = document.getElementById('remote-feedback-toast');
const remoteInputStatusIndicator = document.getElementById('remote-input-status-indicator');

// Now playing elements
const npTitle = document.getElementById('np-title');
const npArtistSinger = document.getElementById('np-artist-singer');
const queueCount = document.getElementById('queue-count');

// Add Queue Modal
const modalAdd = document.getElementById('modal-add');
const modalClose = document.getElementById('modal-close');
const modalSongDetails = document.getElementById('modal-song-details');
const singerNameInput = document.getElementById('singer-name-input');
const modalSubmitBtn = document.getElementById('modal-submit-btn');

// Download Elements
const downloadUrlInput = document.getElementById('download-url-input');
const downloadSingerInput = document.getElementById('download-singer-input');
const downloadSubmitBtn = document.getElementById('download-submit-btn');
const downloadStatus = document.getElementById('download-status');

// Admin Controls Elements
const adminToggleBtn = document.getElementById('admin-toggle-btn');
const adminToggleText = document.getElementById('admin-toggle-text');
const adminControls = document.getElementById('admin-controls');
const modalAdminAuth = document.getElementById('modal-admin-auth');
const modalAdminAuthClose = document.getElementById('modal-admin-auth-close');
const adminAuthPasswordInput = document.getElementById('admin-auth-password-input');
const modalAdminAuthSubmitBtn = document.getElementById('modal-admin-auth-submit-btn');
const ctrlBtnPlay = document.getElementById('ctrl-btn-play');
const ctrlBtnPause = document.getElementById('ctrl-btn-pause');
const ctrlBtnStop = document.getElementById('ctrl-btn-stop');
const ctrlBtnSkip = document.getElementById('ctrl-btn-skip');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadSongs();
  loadQueue();
  updateAdminUI();

  // Load saved singer name
  const savedSinger = localStorage.getItem('singerName') || '';
  if (savedSinger && remoteSingerName) {
    remoteSingerName.value = savedSinger;
  }
  if (savedSinger && singerNameInput) {
    singerNameInput.value = savedSinger;
  }

  // Set default view to Remote
  switchTab('remote');
});

// Socket Events
socket.on('initial_status', (data) => {
  updateQueueUI(data.queue, data.nowPlaying);
  if (data.settings) {
    userRemoteInputEnabled = data.settings.userRemoteInputEnabled !== false;
    updateRemoteLockoutUI();
  }
});

socket.on('queue_updated', (data) => {
  updateQueueUI(data.queue, data.nowPlaying);
});

socket.on('settings_updated', (data) => {
  if (data.settings) {
    userRemoteInputEnabled = data.settings.userRemoteInputEnabled !== false;
    updateRemoteLockoutUI();
  }
});

socket.on('songbook_updated', () => {
  loadSongs();
});

socket.on('download_progress', (data) => {
  if (data && activeTab === 'download' && downloadSubmitBtn.disabled) {
    showDownloadStatus(data.message, 'info');
  }
});

// --- Event Listeners ---
function setupEventListeners() {
  // Tabs
  if (tabRemote) tabRemote.addEventListener('click', () => switchTab('remote'));
  tabBrowse.addEventListener('click', () => switchTab('browse'));
  tabQueue.addEventListener('click', () => switchTab('queue'));
  tabDownload.addEventListener('click', () => switchTab('download'));

  // Search input
  searchInput.addEventListener('input', () => {
    loadSongs(searchInput.value.trim(), currentCategory);
  });

  // Category selection bar
  categoriesBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;

    // Toggle active state styling
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.className = 'cat-btn px-4 py-1.5 rounded-full bg-surface-container border border-white/5 text-on-surface-variant font-semibold text-xs flex-shrink-0 transition-transform active:scale-95';
    });
    btn.className = 'cat-btn px-4 py-1.5 rounded-full bg-primary text-on-primary font-bold text-xs flex-shrink-0 transition-transform active:scale-95';

    currentCategory = btn.getAttribute('data-cat');
    loadSongs(searchInput.value.trim(), currentCategory);
  });

  // Remote Keypad Buttons
  document.querySelectorAll('.mb-key').forEach(btn => {
    btn.addEventListener('click', () => {
      pressRemoteDigit(btn.getAttribute('data-val'));
    });
  });

  if (btnRemoteClear) {
    btnRemoteClear.addEventListener('click', clearRemoteInput);
  }

  if (btnRemoteEnter) {
    btnRemoteEnter.addEventListener('click', submitRemoteQueue);
  }

  if (btnRemoteAuthAdmin) {
    btnRemoteAuthAdmin.addEventListener('click', () => {
      adminAuthPasswordInput.value = '';
      modalAdminAuth.classList.remove('hidden');
      adminAuthPasswordInput.focus();
    });
  }

  // Close modal
  modalClose.addEventListener('click', () => {
    modalAdd.classList.add('hidden');
  });

  // Submit request
  modalSubmitBtn.addEventListener('click', submitQueueRequest);

  // Submit download
  downloadSubmitBtn.addEventListener('click', handleDownloadSubmit);

  // Admin Mode Toggle Button Click
  adminToggleBtn.addEventListener('click', handleAdminToggleClick);

  // Close Admin Auth Modal
  modalAdminAuthClose.addEventListener('click', () => {
    modalAdminAuth.classList.add('hidden');
  });

  // Submit Admin Verification
  modalAdminAuthSubmitBtn.addEventListener('click', submitAdminPassword);
  adminAuthPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitAdminPassword();
    }
  });

  // Admin Playback Commands
  ctrlBtnPlay.addEventListener('click', () => sendPlayStateChange('play'));
  ctrlBtnPause.addEventListener('click', () => sendPlayStateChange('pause'));
  ctrlBtnStop.addEventListener('click', () => sendPlayStateChange('stop'));
  ctrlBtnSkip.addEventListener('click', () => sendPlayStateChange('skip'));
}

// --- Navigation Controller ---
function switchTab(tab) {
  activeTab = tab;

  // Reset tab button styles
  const defaultTabClass = 'pb-2 text-on-surface-variant font-semibold flex items-center gap-1.5 whitespace-nowrap';
  const activeTabClass = 'pb-2 text-primary font-bold border-b-2 border-primary flex items-center gap-1.5 whitespace-nowrap';

  if (tabRemote) tabRemote.className = defaultTabClass;
  tabBrowse.className = defaultTabClass;
  tabQueue.className = defaultTabClass;
  tabDownload.className = defaultTabClass;

  // Hide all view panes
  if (viewRemote) viewRemote.classList.add('hidden');
  viewBrowse.classList.add('hidden');
  viewQueue.classList.add('hidden');
  viewDownload.classList.add('hidden');

  if (tab === 'remote' && viewRemote && tabRemote) {
    tabRemote.className = activeTabClass;
    viewRemote.classList.remove('hidden');
    updateRemoteLockoutUI();
  } else if (tab === 'browse') {
    tabBrowse.className = activeTabClass;
    viewBrowse.classList.remove('hidden');
    loadSongs();
  } else if (tab === 'queue') {
    tabQueue.className = activeTabClass;
    viewQueue.classList.remove('hidden');
    loadQueue();
  } else if (tab === 'download') {
    tabDownload.className = activeTabClass;
    viewDownload.classList.remove('hidden');
    downloadStatus.classList.add('hidden');
    downloadUrlInput.value = '';
  }
}

// --- YouTube Download Controllers ---
async function handleDownloadSubmit() {
  const url = downloadUrlInput.value.trim();
  const singer = downloadSingerInput ? downloadSingerInput.value.trim() : '';

  if (!url) {
    showDownloadStatus('Please enter a YouTube video URL.', 'error');
    return;
  }

  const isYoutube = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|v\/|embed\/)|youtu\.be\/)/i.test(url);
  if (!isYoutube && !url.includes('youtube.com') && !url.includes('youtu.be')) {
    showDownloadStatus('Please enter a valid YouTube link (e.g. youtube.com/watch?v=... or youtu.be/...).', 'error');
    return;
  }

  downloadSubmitBtn.disabled = true;
  downloadSubmitBtn.innerHTML = `
    <span class="material-symbols-outlined text-sm animate-spin">sync</span>
    <span>Adding Song (please wait)...</span>
  `;
  showDownloadStatus('Connecting to YouTube and extracting metadata...', 'info');

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, singerName: singer })
    });

    const data = await res.json();
    if (data.success) {
      const songInfo = data.song;
      downloadUrlInput.value = '';
      if (downloadSingerInput) downloadSingerInput.value = '';

      if (data.queued) {
        showDownloadStatus(
          `🎉 Success! Added "${songInfo.title}" by "${songInfo.artist}" to the waitlist for ${singer}!`, 
          'success',
          {
            buttonText: 'View in Queue',
            action: () => switchTab('queue')
          }
        );
        setTimeout(() => {
          if (activeTab === 'download') {
            switchTab('queue');
          }
        }, 1800);
      } else {
        showDownloadStatus(
          `✅ Added "${songInfo.title}" by "${songInfo.artist}" to the songbook!`, 
          'success',
          {
            buttonText: 'Add to Queue Now',
            action: () => openAddModal(songInfo.id, songInfo.title, songInfo.artist)
          }
        );
      }
    } else {
      showDownloadStatus(`Error: ${data.error || 'Failed to download video.'}`, 'error');
    }
  } catch (err) {
    console.error('Download error:', err);
    showDownloadStatus('A network error occurred. Please verify your connection to the server.', 'error');
  } finally {
    downloadSubmitBtn.disabled = false;
    downloadSubmitBtn.innerHTML = `
      <span class="material-symbols-outlined text-sm font-bold">add_circle</span>
      <span>Download & Add to Queue</span>
    `;
  }
}

function showDownloadStatus(message, type, actionButton = null) {
  downloadStatus.classList.remove('hidden');
  downloadStatus.innerHTML = '';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'flex items-center gap-2';

  if (type === 'info') {
    contentDiv.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin flex-shrink-0">progress_activity</span><span>${message}</span>`;
  } else if (type === 'success') {
    contentDiv.innerHTML = `<span class="material-symbols-outlined text-sm text-primary flex-shrink-0">check_circle</span><span>${message}</span>`;
  } else {
    contentDiv.innerHTML = `<span class="material-symbols-outlined text-sm text-red-400 flex-shrink-0">error</span><span>${message}</span>`;
  }

  downloadStatus.appendChild(contentDiv);

  if (actionButton) {
    const btn = document.createElement('button');
    btn.className = 'mt-3 w-full py-2 px-3 rounded-lg bg-primary text-on-primary font-bold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 active:scale-95 transition-all shadow-md';
    btn.innerHTML = `<span class="material-symbols-outlined text-xs">queue_music</span><span>${actionButton.buttonText}</span>`;
    btn.onclick = actionButton.action;
    downloadStatus.appendChild(btn);
  }

  if (type === 'error') {
    downloadStatus.className = 'text-xs p-3.5 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 font-medium';
  } else if (type === 'success') {
    downloadStatus.className = 'text-xs p-3.5 rounded-xl border border-primary/20 bg-primary/10 text-primary font-medium';
  } else {
    downloadStatus.className = 'text-xs p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-400 font-medium';
  }
}

// --- API Methods ---
async function loadSongs(query = '', category = '') {
  try {
    let url = `/api/songs?q=${encodeURIComponent(query)}`;
    if (category && category !== 'All Songs') {
      url += `&category=${encodeURIComponent(category)}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      songs = data.songs;
      renderBrowseList();
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

// --- Render Lists ---
function renderBrowseList() {
  songsList.innerHTML = '';
  if (songs.length === 0) {
    songsList.innerHTML = `
      <div class="py-12 text-center text-on-surface-variant text-xs">
        No songs found in this category
      </div>
    `;
    return;
  }

  songs.forEach(song => {
    const songNum = song.song_number || song.id;
    const row = document.createElement('div');
    row.className = 'bg-surface-container p-3 rounded-xl flex items-center justify-between border border-white/5 gap-3';
    row.innerHTML = `
      <div class="min-w-0 flex-grow pr-2">
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="px-2 py-0.5 rounded bg-primary/20 text-primary font-mono font-bold text-[10px] flex-shrink-0">
            #${songNum}
          </span>
          <h4 class="font-bold text-xs text-white truncate leading-tight">${song.title}</h4>
        </div>
        <p class="text-[10px] text-on-surface-variant truncate">${song.artist} &bull; <span class="text-white/60">${song.category || 'Pop'}</span></p>
      </div>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <button class="w-8 h-8 rounded-full bg-surface-container-high border border-white/10 text-on-surface hover:text-primary flex items-center justify-center transition-all active:scale-95" title="Type on Remote" onclick="fillRemoteNumber('${songNum}')">
          <span class="material-symbols-outlined text-sm text-primary">pin</span>
        </button>
        <button class="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all active:scale-95" title="Quick Queue" onclick="openAddModal(${song.id}, '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}')">
          <span class="material-symbols-outlined text-md">add</span>
        </button>
      </div>
    `;
    songsList.appendChild(row);
  });
}

function renderQueueList() {
  queueList.innerHTML = '';
  const pending = queue.filter(item => item.status !== 'singing');
  if (pending.length === 0) {
    queueList.innerHTML = `
      <div class="py-12 text-center text-on-surface-variant text-xs">
        No songs in waitlist. Be the first to add!
      </div>
    `;
    return;
  }

  pending.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'bg-surface-container p-3.5 rounded-xl flex items-center gap-3 border border-white/5';
    row.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center font-bold text-xs text-on-surface-variant flex-shrink-0">
        ${index + 1}
      </div>
      <div class="min-w-0 flex-grow">
        <div class="flex items-center gap-1.5 mb-0.5">
          ${item.song_number ? `<span class="px-1.5 py-0.2 rounded bg-primary/20 text-primary font-mono font-bold text-[10px]">#${item.song_number}</span>` : ''}
          <h4 class="font-bold text-xs text-white truncate leading-tight">${item.title}</h4>
        </div>
        <p class="text-[10px] text-on-surface-variant truncate">${item.artist} &bull; Singer: <span class="text-primary font-bold">${item.singer_name}</span></p>
      </div>
    `;
    queueList.appendChild(row);
  });
}

function updateQueueUI(queueData, current) {
  queue = queueData;
  nowPlaying = current;
  
  const waitlistCount = queue.filter(item => item.status !== 'singing').length;
  queueCount.textContent = `${waitlistCount} songs`;

  // Update Now Playing card
  if (nowPlaying) {
    npTitle.textContent = `${nowPlaying.song_number ? '#' + nowPlaying.song_number + ' - ' : ''}${nowPlaying.title}`;
    npArtistSinger.textContent = `${nowPlaying.artist} • Singer: ${nowPlaying.singer_name}`;
  } else {
    npTitle.textContent = 'No Song Playing';
    npArtistSinger.textContent = 'Queue a song on the remote';
  }

  if (activeTab === 'queue') {
    renderQueueList();
  }
}

// --- Add to Queue Modal Controller ---
function openAddModal(songId, title, artist) {
  selectedSongId = songId;
  modalSongDetails.textContent = `${title} - ${artist}`;
  modalAdd.classList.remove('hidden');
  singerNameInput.focus();
}

window.openAddModal = openAddModal;

async function submitQueueRequest() {
  const singerName = singerNameInput.value.trim();
  if (!singerName) {
    alert('Please enter your name.');
    return;
  }

  localStorage.setItem('singerName', singerName);
  modalSubmitBtn.disabled = true;
  modalSubmitBtn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId: selectedSongId,
        singerName,
        isRemote: true,
        adminAuth: sessionStorage.getItem('adminPassword')
      })
    });
    const data = await res.json();
    if (data.success) {
      modalAdd.classList.add('hidden');
      loadQueue();
      switchTab('queue');
    } else {
      alert(data.error);
    }
  } catch (err) {
    console.error('Error submitting queue request:', err);
  } finally {
    modalSubmitBtn.disabled = false;
    modalSubmitBtn.textContent = 'Submit Request';
  }
}

// --- Admin Controllers ---
function updateAdminUI() {
  if (isAdmin) {
    adminToggleBtn.className = 'px-2.5 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold hover:bg-primary/30 flex items-center gap-1 active:scale-95 transition-all';
    adminToggleBtn.querySelector('.material-symbols-outlined').textContent = 'lock_open';
    adminToggleText.textContent = 'Exit Admin';
    adminControls.classList.remove('hidden');
  } else {
    adminToggleBtn.className = 'px-2.5 py-1 rounded-full bg-surface-container border border-white/5 text-on-surface-variant text-[10px] font-bold hover:bg-surface-container-high flex items-center gap-1 active:scale-95 transition-all';
    adminToggleBtn.querySelector('.material-symbols-outlined').textContent = 'lock';
    adminToggleText.textContent = 'Admin';
    adminControls.classList.add('hidden');
  }

  updateRemoteLockoutUI();
}

function handleAdminToggleClick() {
  if (isAdmin) {
    isAdmin = false;
    sessionStorage.removeItem('isAdmin');
    sessionStorage.removeItem('adminPassword');
    updateAdminUI();
  } else {
    adminAuthPasswordInput.value = '';
    modalAdminAuth.classList.remove('hidden');
    adminAuthPasswordInput.focus();
  }
}

async function submitAdminPassword() {
  const password = adminAuthPasswordInput.value;
  if (!password) {
    alert('Please enter the password.');
    return;
  }

  modalAdminAuthSubmitBtn.disabled = true;
  modalAdminAuthSubmitBtn.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
      isAdmin = true;
      sessionStorage.setItem('isAdmin', 'true');
      sessionStorage.setItem('adminPassword', password);
      modalAdminAuth.classList.add('hidden');
      updateAdminUI();
      showRemoteFeedback('👑 Administrator Mode Activated', 'success');
    } else {
      alert(data.error || 'Verification failed.');
    }
  } catch (err) {
    console.error('Error verifying admin password:', err);
    alert('A connection error occurred.');
  } finally {
    modalAdminAuthSubmitBtn.disabled = false;
    modalAdminAuthSubmitBtn.textContent = 'Verify Password';
  }
}

function sendPlayStateChange(action) {
  if (!isAdmin) return;
  socket.emit('play_state_change', { action });
}

// ==========================================
// NOSTALGIC VIDEOKE REMOTE LOGIC & VOICE
// ==========================================

function playBeepTone(freq = 750) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch (e) {}
}

// Pre-load authentic Platinum Karaoke voice clips (0-9)
const platinumVoiceAudios = {};
for (let i = 0; i <= 9; i++) {
  const audio = new Audio(`/audio/digit_${i}.mp3`);
  audio.preload = 'auto';
  platinumVoiceAudios[i] = audio;
}

function playPlatinumDigitVoice(digit) {
  if (mobileVoiceToggle && !mobileVoiceToggle.checked) return;
  const num = parseInt(digit, 10);
  if (isNaN(num) || num < 0 || num > 9) return;

  try {
    const audio = platinumVoiceAudios[num] || new Audio(`/audio/digit_${num}.mp3`);
    audio.currentTime = 0;
    const p = audio.play();
    if (p !== undefined) {
      p.catch(() => {
        speakVoice(DIGIT_WORDS[num] || digit);
      });
    }
  } catch (e) {
    speakVoice(DIGIT_WORDS[num] || digit);
  }
}

function speakVoice(text) {
  if (!('speechSynthesis' in window)) return;
  if (mobileVoiceToggle && !mobileVoiceToggle.checked) return;

  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.15;
    utter.pitch = 1.0;
    utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function updateRemoteLockoutUI() {
  if (!remoteLockoutCard || !remoteActivePanel) return;

  if (userRemoteInputEnabled === false && !isAdmin) {
    // Input is locked for regular singers
    remoteLockoutCard.classList.remove('hidden');
    if (remoteInputStatusIndicator) {
      remoteInputStatusIndicator.textContent = 'LOCKED';
      remoteInputStatusIndicator.className = 'text-amber-400 font-mono';
    }
    // Dim keypad buttons
    document.querySelectorAll('.mb-key').forEach(b => {
      b.classList.add('opacity-40', 'pointer-events-none');
    });
    if (btnRemoteEnter) btnRemoteEnter.classList.add('opacity-40', 'pointer-events-none');
    if (btnRemoteClear) btnRemoteClear.classList.add('opacity-40', 'pointer-events-none');
  } else {
    // Enabled or user is Admin
    remoteLockoutCard.classList.add('hidden');
    if (remoteInputStatusIndicator) {
      if (isAdmin && userRemoteInputEnabled === false) {
        remoteInputStatusIndicator.textContent = 'ADMIN ONLY';
        remoteInputStatusIndicator.className = 'text-yellow-400 font-mono';
      } else {
        remoteInputStatusIndicator.textContent = 'READY';
        remoteInputStatusIndicator.className = 'text-emerald-400 font-mono';
      }
    }
    // Enable keypad buttons
    document.querySelectorAll('.mb-key').forEach(b => {
      b.classList.remove('opacity-40', 'pointer-events-none');
    });
    if (btnRemoteEnter) btnRemoteEnter.classList.remove('opacity-40', 'pointer-events-none');
    if (btnRemoteClear) btnRemoteClear.classList.remove('opacity-40', 'pointer-events-none');
  }
}

function updateRemoteDisplay() {
  if (!remoteLcdNumbers || !remoteMatchedSongBox) return;

  if (!remoteCode) {
    remoteLcdNumbers.textContent = '_ _ _ _ _';
    remoteMatchedSongBox.textContent = 'Enter 4-5 digit song code from Songbook';
    remoteMatchedSongBox.className = 'p-2 rounded-xl bg-white/5 border border-white/5 text-[11px] text-white/70 min-h-[38px] flex items-center justify-center truncate px-2 font-medium';
    return;
  }

  // Format code digits with spaces e.g. 1 0 0 0 1
  const chars = remoteCode.split('');
  while (chars.length < 5) chars.push('_');
  remoteLcdNumbers.textContent = chars.join(' ');

  if (remoteCode.length >= 3) {
    fetch(`/api/songs/by-number/${remoteCode}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.song) {
          remoteMatchedSongBox.textContent = `🎵 ${data.song.title} - ${data.song.artist}`;
          remoteMatchedSongBox.className = 'p-2 rounded-xl bg-primary/10 border border-primary/30 text-[11px] text-primary min-h-[38px] flex items-center justify-center truncate px-2 font-bold animate-pulse';
        } else {
          remoteMatchedSongBox.textContent = `No song found for #${remoteCode}`;
          remoteMatchedSongBox.className = 'p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 min-h-[38px] flex items-center justify-center truncate px-2 font-medium';
        }
      })
      .catch(() => {
        remoteMatchedSongBox.textContent = `Searching #${remoteCode}...`;
      });
  } else {
    remoteMatchedSongBox.textContent = `Entering code (${remoteCode.length}/5)...`;
    remoteMatchedSongBox.className = 'p-2 rounded-xl bg-white/5 border border-white/5 text-[11px] text-white/70 min-h-[38px] flex items-center justify-center truncate px-2 font-medium';
  }
}

function pressRemoteDigit(digit) {
  if (userRemoteInputEnabled === false && !isAdmin) {
    showRemoteFeedback('🔒 Remote input is disabled by Admin.', 'error');
    speakVoice('Locked');
    playBeepTone(250);
    return;
  }

  const num = parseInt(digit, 10);
  if (isNaN(num)) return;
  if (remoteCode.length >= 5) return;

  remoteCode += digit;
  playPlatinumDigitVoice(num);
  playBeepTone(600 + num * 50);
  updateRemoteDisplay();
}

function clearRemoteInput() {
  if (userRemoteInputEnabled === false && !isAdmin) return;
  remoteCode = '';
  speakVoice('Clear');
  playBeepTone(350);
  updateRemoteDisplay();
}

async function submitRemoteQueue() {
  if (userRemoteInputEnabled === false && !isAdmin) {
    showRemoteFeedback('🔒 Remote input is disabled by Admin. Only Admin can choose songs.', 'error');
    speakVoice('Locked');
    playBeepTone(250);
    return;
  }

  if (!remoteCode) {
    showRemoteFeedback('Please enter a song number.', 'error');
    return;
  }

  const singer = (remoteSingerName && remoteSingerName.value.trim()) ? remoteSingerName.value.trim() : 'Singer';
  localStorage.setItem('singerName', singer);

  btnRemoteEnter.disabled = true;
  btnRemoteEnter.textContent = '...';

  try {
    const res = await fetch('/api/queue/by-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songNumber: remoteCode,
        singerName: singer,
        isRemote: true,
        adminAuth: sessionStorage.getItem('adminPassword')
      })
    });
    const data = await res.json();
    if (data.success) {
      speakVoice('Song Reserved!');
      playBeepTone(900);
      setTimeout(() => playBeepTone(1200), 100);

      showRemoteFeedback(`🎉 Queued: ${data.song.title} (#${data.song.song_number}) for ${singer}!`, 'success');
      remoteCode = '';
      updateRemoteDisplay();
    } else {
      speakVoice('Error');
      playBeepTone(250);
      showRemoteFeedback(`❌ ${data.error || 'Failed to queue song'}`, 'error');
    }
  } catch (err) {
    console.error('Remote queue error:', err);
    showRemoteFeedback('❌ Network error. Check connection.', 'error');
  } finally {
    btnRemoteEnter.disabled = false;
    btnRemoteEnter.textContent = 'ENTER';
  }
}

function showRemoteFeedback(msg, type = 'info') {
  if (!remoteFeedbackToast) return;
  remoteFeedbackToast.textContent = msg;
  remoteFeedbackToast.classList.remove('hidden');

  if (type === 'success') {
    remoteFeedbackToast.className = 'p-3 rounded-xl text-center text-xs font-bold border border-primary/30 bg-primary/10 text-primary shadow-lg';
  } else if (type === 'error') {
    remoteFeedbackToast.className = 'p-3 rounded-xl text-center text-xs font-bold border border-red-500/30 bg-red-500/10 text-red-400 shadow-lg';
  } else {
    remoteFeedbackToast.className = 'p-3 rounded-xl text-center text-xs font-bold border border-white/10 bg-white/5 text-white shadow-lg';
  }

  setTimeout(() => {
    remoteFeedbackToast.classList.add('hidden');
  }, 3500);
}

function fillRemoteNumber(code) {
  remoteCode = String(code);
  switchTab('remote');
  updateRemoteDisplay();
}
window.fillRemoteNumber = fillRemoteNumber;
