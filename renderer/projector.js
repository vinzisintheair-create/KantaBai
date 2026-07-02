// Elements
const videoElement = document.getElementById('video-element');
const fsSingerName = document.getElementById('fs-singer-name');
const fsSongTitle = document.getElementById('fs-song-title');
const fsSongArtist = document.getElementById('fs-song-artist');
const fsQueueCount = document.getElementById('fs-queue-count');
const fsQueueGrid = document.getElementById('fs-queue-grid');
const fsTimeCur = document.getElementById('fs-time-cur');
const fsProgressBar = document.getElementById('fs-progress-bar');
const fsTimeTotal = document.getElementById('fs-time-total');
const fsIdlePrompt = document.getElementById('fs-idle-prompt');
const projectorHeader = document.getElementById('projector-header');
const projectorFooter = document.getElementById('projector-footer');

let isFullscreen = false;
let overlayTimeout = null;

// Helper to format seconds to MM:SS
function formatTime(sec) {
  if (isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Cinematic Overlays Controller (Auto-hide when playing)
function showOverlays() {
  projectorHeader.classList.remove('hidden-overlay-top');
  projectorFooter.classList.remove('hidden-overlay-bottom');

  if (overlayTimeout) clearTimeout(overlayTimeout);

  // Auto-hide after 3.5 seconds if video is active and playing
  if (videoElement && !videoElement.paused && !videoElement.ended && videoElement.src) {
    overlayTimeout = setTimeout(() => {
      projectorHeader.classList.add('hidden-overlay-top');
      projectorFooter.classList.add('hidden-overlay-bottom');
    }, 3500);
  }
}

// Reset idle overlay and hide triggers on mouse move or clicks
document.addEventListener('mousemove', showOverlays);
document.addEventListener('click', showOverlays);

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
    } else {
      videoElement.src = '';
      fsIdlePrompt.classList.remove('hidden');
    }

    // Set metadata
    fsSingerName.textContent = data.singer || 'Guest';
    fsSongTitle.textContent = data.title || '--';
    fsSongArtist.textContent = data.artist || '--';
    
    if (data.src) {
      fsIdlePrompt.classList.add('hidden');
    }
    
    showOverlays();
  });

  // Listen for playback state modifications
  window.electronAPI.onProjectorMessage('projector-play', () => {
    videoElement.play().catch(console.error);
  });

  window.electronAPI.onProjectorMessage('projector-pause', () => {
    videoElement.pause();
  });

  window.electronAPI.onProjectorMessage('projector-volume', (vol) => {
    videoElement.volume = vol / 100;
  });

  // Listen for waitlist queue updates to display preview cards
  window.electronAPI.onProjectorMessage('projector-queue', (data) => {
    const queue = data.queue || [];
    const waitlistCount = queue.filter(item => item.status !== 'singing').length;
    fsQueueCount.textContent = `${waitlistCount} songs in waitlist`;

    fsQueueGrid.innerHTML = '';
    const pendingSongs = queue.filter(item => item.status !== 'singing');

    if (pendingSongs.length === 0) {
      fsQueueGrid.innerHTML = `
        <div class="bg-white/5 p-3 rounded-xl flex items-center justify-center border border-white/5 text-xs text-on-surface-variant font-medium col-span-4 h-14">
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
  });
}

// --- Video event triggers to push state back to Control Panel ---
videoElement.addEventListener('timeupdate', () => {
  const curTime = videoElement.currentTime;
  const totalDuration = videoElement.duration || 0;

  // Update projector local progress bars
  fsTimeCur.textContent = formatTime(curTime);
  fsTimeTotal.textContent = formatTime(totalDuration);
  
  if (totalDuration > 0) {
    const percent = (curTime / totalDuration) * 100;
    fsProgressBar.style.width = `${percent}%`;
  } else {
    fsProgressBar.style.width = '0%';
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
  showOverlays();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-play-state', 'play');
  }
});

videoElement.addEventListener('pause', () => {
  showOverlays();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-play-state', 'pause');
  }
});

videoElement.addEventListener('ended', () => {
  showOverlays();
  if (window.electronAPI && window.electronAPI.sendToControl) {
    window.electronAPI.sendToControl('projector-ended');
  }
});
