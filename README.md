# 🎤 KantaBai — Premium Offline-First Videoke Application

**KantaBai** is a premium, offline-first desktop karaoke (videoke) experience built on Electron, featuring a web-based mobile companion controller. 

Designed for low-latency offline entertainment, KantaBai allows users to scan their local video directories, catalog songs dynamically by category, and sing along to studio-quality video tracks. Guest performers can connect their mobile phones instantly by scanning a QR code on the screen, letting them search the catalog and queue up songs without interrupting the singer.

---

## 🌟 Key Features

* **Offline-First Videoke Engine:** Play local video files (`.mp4`, `.mkv`, `.avi`, `.webm`, etc.) with GPU acceleration and native player controls.
* **Mobile Companion Web App:** Scan a dynamically generated QR code on the desktop app to turn any smartphone into a remote control. Search the library, request songs, and track waitlists.
* **Automatic Library Scanner:** Point the directory scanner at your karaoke video folder. It automatically indexes files and extracts `Artist - Title` metadata from filenames.
* **Real-time Synchronization:** Built-in WebSocket connection (via Socket.IO) updates the waitlist, currently playing tracks, and settings instantly across all screens.
* **Admin Verification Console:** Access administrative controls to rearrange the queue order, skip tracks, remove items, or clear waitlists.
* **Ambient Visuals & Fullscreen mode:** Immersive fullscreen video playback layout with smart auto-hiding navigation bars and overlay status displays.

---

## 🛠️ Technology Stack

* **Desktop Application:** [Electron](https://www.electronjs.org/)
* **Backend Web Server:** [Node.js](https://nodejs.org/), [Express](https://expressjs.com/), [Socket.IO](https://socket.io/)
* **Database Engine:** [SQLite3](https://www.sqlite.org/) (via `sqlite` / `sqlite3` packages)
* **Styling (CSS):** Modern responsive styles via [TailwindCSS](https://tailwindcss.com/) CDN and custom Glassmorphism designs.

---

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v16+ recommended)
* [npm](https://www.npmjs.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/vinzisintheair-create/KantaBai.git
   cd KantaBai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the verification/unit tests to ensure database initialization works:
   ```bash
   npm test
   ```

4. Start the application:
   ```bash
   npm start
   ```

---

## 📦 Packaging

To compile a portable Windows executable (`.exe`) branded with the custom transparent KantaBai icon:

```bash
npm run build
```

The output standalone binary will be created in the `dist/` directory.

---

## 🤝 Contributing

Contributions, bug reports, and pull requests are welcome. Feel free to open issues or check the repository status.
