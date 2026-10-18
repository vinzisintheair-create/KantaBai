// Elements
const videoElement = document.getElementById('video-element');
const fsSingerName = document.getElementById('fs-singer-name');
const fsSongTitle = document.getElementById('fs-song-title');
const fsSongArtist = document.getElementById('fs-song-artist');
const fsSongNumber = document.getElementById('fs-song-number');
const fsSongNumberTag = document.getElementById('fs-song-number-tag');

const fsQueueCount = document.getElementById('fs-queue-count');
const fsNextTitle = document.getElementById('fs-next-title');
const fsNextSinger = document.getElementById('fs-next-singer');
const fsNextSingerTag = document.getElementById('fs-next-singer-tag');
const fsNextNumber = document.getElementById('fs-next-number');
const fsNextNumberTag = document.getElementById('fs-next-number-tag');

const projectorReservedToast = document.getElementById('projector-reserved-toast');
const reservedToastText = document.getElementById('reserved-toast-text');

const fsIdleQueueCount = document.getElementById('fs-idle-queue-count');
const fsIdleQueueList = document.getElementById('fs-idle-queue-list');

const fsTimeCur = document.getElementById('fs-time-cur');
const fsProgressBar = document.getElementById('fs-progress-bar');
const fsTimeTotal = document.getElementById('fs-time-total');
const fsIdlePrompt = document.getElementById('fs-idle-prompt');
const projectorFooter = document.getElementById('projector-footer');

let isFullscreen = false;
let footerTimeout = null;
let reservedToastTimeout = null;

// Helper to format seconds to MM:SS
function formatTime(sec) {
  if (isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Playback footer overlay controller:
// Auto-hides progress bar after 3.5s so bottom lyrics are NEVER covered!
// The top bar (song title, singer, next in queue) is PERMANENT.
function showFooterOverlay() {
  if (!projectorFooter) return;
  projectorFooter.classList.remove('hidden-overlay-bottom');

  if (footerTimeout) clearTimeout(footerTimeout);

  if (videoElement && !videoElement.paused && !videoElement.ended && videoElement.src) {
    footerTimeout = setTimeout(() => {
      projectorFooter.classList.add('hidden-overlay-bottom');
    }, 3500);
  }
}

// Classic Videoke Reservation Banner Toast
function showReservationBanner(data) {
  if (!projectorReservedToast || !reservedToastText) return;
  const numStr = data.songNumber || (data.song && data.song.song_number) || '';
  const title = (data.song && data.song.title) || data.title || 'Track';
  const singer = data.singerName || data.singer || 'Guest';
  
  reservedToastText.textContent = `${numStr ? '#' + numStr + ' ' : ''}${title} • Singer: ${singer}`;
  
  projectorReservedToast.classList.remove('opacity-0', '-translate-y-4');
  projectorReservedToast.classList.add('opacity-100', 'translate-y-0');

  if (reservedToastTimeout) clearTimeout(reservedToastTimeout);
  reservedToastTimeout = setTimeout(() => {
    projectorReservedToast.classList.remove('opacity-100', 'translate-y-0');
    projectorReservedToast.classList.add('opacity-0', '-translate-y-4');
  }, 4500);
}

// Reveal progress bar temporarily when mouse moves or window clicked
document.addEventListener('mousemove', showFooterOverlay);
document.addEventListener('click', showFooterOverlay);

// Native Fullscreen Controller
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  if (window.electronAPI && window.electronAPI.setProjectorFullscreen) {
    window.electronAPI.setProjectorFullscreen(isFullscreen);
  }
}

document.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
});

// --- IPC Commands from Control Panel ---
if (window.electronAPI) {
  // Listen for video loading
  window.electronAPI.onProjectorMessage('projector-load', (data) => {
    console.log('[Projector] Loading video:', data);
    
    // Set video src
    if (data.src) {
      videoElement.src = data.src;
      videoElement.load();
      videoElement.play().catch(err => {
        console.error('Play failed:', err);
      });
      if (fsIdlePrompt) fsIdlePrompt.classList.add('hidden');
    } else {
      videoElement.src = '';
      if (fsIdlePrompt) fsIdlePrompt.classList.remove('hidden');
    }

    // Set permanent top banner metadata
    if (fsSingerName) fsSingerName.textContent = data.singer || 'Guest';
    if (fsSongTitle) fsSongTitle.textContent = data.title || 'No Song Playing';
    if (fsSongArtist) fsSongArtist.textContent = data.artist || '--';
    
    if (fsSongNumber && fsSongNumberTag) {
      if (data.songNumber) {
        fsSongNumber.textContent = `#${data.songNumber}`;
        fsSongNumberTag.classList.remove('hidden');
      } else {
        fsSongNumberTag.classList.add('hidden');
      }
    }
    
    showFooterOverlay();
  });

  // Listen for song reservation popup
  window.electronAPI.onProjectorMessage('projector-reserved', (data) => {
    showReservationBanner(data);
  });

  // Listen for playback state modifications
  window.electronAPI.onProjectorMessage('projector-play', () => {
    videoElement.play().catch(console.error);
    showFooterOverlay();
  });

  window.electronAPI.onProjectorMessage('projector-pause', () => {
    videoElement.pause();
    showFooterOverlay();
  });

  window.electronAPI.onProjectorMessage('projector-stop', () => {
    videoElement.pause();
    videoElement.currentTime = 0;
    if (fsIdlePrompt) fsIdlePrompt.classList.remove('hidden');
  });

  window.electronAPI.onProjectorMessage('projector-volume', (vol) => {
    videoElement.volume = vol / 100;
  });

  // Listen for waitlist queue updates to display Next in Queue permanently
  window.electronAPI.onProjectorMessage('projector-queue', (data) => {
    const queue = data.queue || [];
    const pendingSongs = queue.filter(item => item.status !== 'singing');
    const waitlistCount = pendingSongs.length;

    // Permanent Top Bar - Queue Count
    if (fsQueueCount) {
      fsQueueCount.textContent = `(${waitlistCount})`;
    }

    // Permanent Top Bar - Next in Queue Song & Singer
    if (pendingSongs.length > 0) {
      const nextSong = pendingSongs[0];
      if (fsNextTitle) fsNextTitle.textContent = nextSong.title;
      if (fsNextSinger) fsNextSinger.textContent = nextSong.singer_name;
      if (fsNextSingerTag) fsNextSingerTag.classList.remove('hidden');
      
      if (fsNextNumber && fsNextNumberTag) {
        if (nextSong.song_number) {
          fsNextNumber.textContent = nextSong.song_number;
          fsNextNumberTag.classList.remove('hidden');
        } else {
          fsNextNumberTag.classList.add('hidden');
        }
      }
    } else {
      if (fsNextTitle) fsNextTitle.textContent = 'Waitlist Empty';
      if (fsNextSingerTag) fsNextSingerTag.classList.add('hidden');
      if (fsNextNumberTag) fsNextNumberTag.classList.add('hidden');
    }

    // Idle Screen Waitlist Preview
    if (fsIdleQueueCount) {
      fsIdleQueueCount.textContent = `${waitlistCount} songs`;
    }

    if (fsIdleQueueList) {
      if (pendingSongs.length === 0) {
        fsIdleQueueList.innerHTML = `
          <div class="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-on-surface-variant text-center">
            Queue is empty. Use the remote control or enter song code to sing!
          </div>
        `;
      } else {
        fsIdleQueueList.innerHTML = '';
        pendingSongs.slice(0, 3).forEach((item, index) => {
          const row = document.createElement('div');
          row.className = 'p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3 text-xs';
          row.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="w-5 h-5 rounded-full ${index === 0 ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/50'} flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                ${index + 1}
              </span>
              <div class="truncate">
                ${item.song_number ? `<span class="text-primary font-mono font-bold mr-1">[#${item.song_number}]</span>` : ''}
                <span class="font-bold text-white">${item.title}</span>
                <span class="text-on-surface-variant text-[11px] ml-1">(${item.artist})</span>
              </div>
            </div>
            <span class="text-primary font-bold text-[11px] flex-shrink-0">${item.singer_name}</span>
          `;
          fsIdleQueueList.appendChild(row);
        });
      }
    }
  });
}

// --- Video event triggers to push state back to Control Panel ---
videoElement.addEventListener('timeupdate', () => {
  const curTime = videoElement.currentTime;
  const totalDuration = videoElement.duration || 0;

  // Update projector local progress bars
  if (fsTimeCur) fsTimeCur.textContent = formatTime(curTime);
  if (fsTimeTotal) fsTimeTotal.textContent = formatTime(totalDuration);
  
  if (totalDuration > 0) {
    const percent = (curTime / totalDuration) * 100;
    if (fsProgressBar) fsProgressBar.style.width = `${percent}%`;
  } else {
    if (fsProgressBar) fsProgressBar.style.width = '0%';
  }

  // Push updates to main control panel
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-timeupdate', {
      currentTime: curTime,
      duration: totalDuration
    });
  }
});

videoElement.addEventListener('play', () => {
  showFooterOverlay();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-play-state', 'play');
  }
});

videoElement.addEventListener('pause', () => {
  showFooterOverlay();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-play-state', 'pause');
  }
});

videoElement.addEventListener('ended', () => {
  showFooterOverlay();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-ended');
  }
});

// Notify control window that the projector screen is ready to sync
if (window.electronAPI && window.electronAPI.sendToControl) {
  window.electronAPI.sendToControl('projector-ready');
}
