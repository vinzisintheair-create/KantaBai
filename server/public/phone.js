const socket = io();

// State variables
let activeTab = 'browse';
let songs = [];
let queue = [];
let nowPlaying = null;
let currentCategory = 'All Songs';
let selectedSongId = null;

// DOM Elements
const tabBrowse = document.getElementById('tab-btn-browse');
const tabQueue = document.getElementById('tab-btn-queue');
const viewBrowse = document.getElementById('view-browse');
const viewQueue = document.getElementById('view-queue');
const searchInput = document.getElementById('search-input');
const categoriesBar = document.getElementById('categories-bar');
const songsList = document.getElementById('songs-list');
const queueList = document.getElementById('queue-list');

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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadSongs();
  loadQueue();
});

// Socket Events
socket.on('initial_status', (data) => {
  updateQueueUI(data.queue, data.nowPlaying);
});

socket.on('queue_updated', (data) => {
  updateQueueUI(data.queue, data.nowPlaying);
});

// --- Event Listeners ---
function setupEventListeners() {
  // Tabs
  tabBrowse.addEventListener('click', () => switchTab('browse'));
  tabQueue.addEventListener('click', () => switchTab('queue'));

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

  // Close modal
  modalClose.addEventListener('click', () => {
    modalAdd.classList.add('hidden');
  });

  // Submit request
  modalSubmitBtn.addEventListener('click', submitQueueRequest);
}

// --- Navigation Controller ---
function switchTab(tab) {
  activeTab = tab;
  if (tab === 'browse') {
    tabBrowse.className = 'pb-2 text-primary font-bold border-b-2 border-primary';
    tabQueue.className = 'pb-2 text-on-surface-variant font-semibold';
    viewBrowse.classList.remove('hidden');
    viewQueue.classList.add('hidden');
    loadSongs();
  } else {
    tabQueue.className = 'pb-2 text-primary font-bold border-b-2 border-primary';
    tabBrowse.className = 'pb-2 text-on-surface-variant font-semibold';
    viewQueue.classList.remove('hidden');
    viewBrowse.classList.add('hidden');
    loadQueue();
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
    const row = document.createElement('div');
    row.className = 'bg-surface-container p-3 rounded-xl flex items-center justify-between border border-white/5';
    row.innerHTML = `
      <div class="min-w-0 flex-grow pr-4">
        <h4 class="font-bold text-xs text-white truncate leading-tight">${song.title}</h4>
        <p class="text-[10px] text-on-surface-variant truncate mt-0.5">${song.artist}</p>
      </div>
      <button class="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all flex-shrink-0 active:scale-95" onclick="openAddModal(${song.id}, '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}')">
        <span class="material-symbols-outlined text-md">add</span>
      </button>
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
        <h4 class="font-bold text-xs text-white truncate leading-tight">${item.title}</h4>
        <p class="text-[10px] text-on-surface-variant truncate mt-0.5">${item.artist} &bull; Singer: <span class="text-primary font-bold">${item.singer_name}</span></p>
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
    npTitle.textContent = nowPlaying.title;
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

// Expose globally for onclick event
window.openAddModal = openAddModal;

async function submitQueueRequest() {
  const singerName = singerNameInput.value.trim();
  if (!singerName) {
    alert('Please enter your name.');
    return;
  }

  modalSubmitBtn.disabled = true;
  modalSubmitBtn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: selectedSongId, singerName })
    });
    const data = await res.json();
    if (data.success) {
      modalAdd.classList.add('hidden');
      loadQueue();
      // Switch to queue tab to see status
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
