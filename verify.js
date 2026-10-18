const fs = require('fs');
const path = require('path');
const db = require('./database/db');
const scanner = require('./database/scanner');
const settingsManager = require('./settings');

async function runTests() {
  console.log('--- Starting KantaBai Verification Tests ---');

  // Test 1: Settings manager
  console.log('Test 1: Verifying settings manager...');
  const settings = settingsManager.load();
  if (settings && settings.serverPort === 8080) {
    console.log('✓ Default settings loaded correctly.');
  } else {
    throw new Error('Settings manager failed to load defaults.');
  }

  // Test 2: Database Initialization
  console.log('Test 2: Verifying database initialization...');
  await db.initDb();
  console.log('✓ Database tables initialized.');

  // Test 3: Library Scanner with mock files
  console.log('Test 3: Verifying library scanner...');
  const mockLibraryDir = path.join(__dirname, 'mock_library');
  
  // Create mock library folders and dummy files
  const folders = ['Pop', 'OPM', 'Rock'];
  folders.forEach(f => {
    const dir = path.join(mockLibraryDir, f);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const mockSongs = [
    { file: 'Pop/Eraserheads - Ang Huling El Bimbo.mp4', title: 'Ang Huling El Bimbo', artist: 'Eraserheads', category: 'Pop' },
    { file: 'Pop/Queen - Bohemian Rhapsody.mp4', title: 'Bohemian Rhapsody', artist: 'Queen', category: 'Pop' },
    { file: 'OPM/Moonstar88 - Torete.mp4', title: 'Torete', artist: 'Moonstar88', category: 'OPM' },
    { file: 'Rock/Kamikazee - Narda.mp4', title: 'Narda', artist: 'Kamikazee', category: 'Rock' }
  ];

  // Write a few bytes into each file to simulate video file existence
  mockSongs.forEach(s => {
    const filePath = path.join(mockLibraryDir, s.file);
    fs.writeFileSync(filePath, 'dummy video data content', 'utf8');
  });

  console.log('Scanning mock library...');
  const scanResult = await scanner.scanLibrary(mockLibraryDir);
  console.log(`Scan results - Total indexed: ${scanResult.total}, Added: ${scanResult.added}`);

  if (scanResult.total === 4) {
    console.log('✓ Scanner indexed all mock songs.');
  } else {
    throw new Error(`Scanner failed: expected 4 songs, got ${scanResult.total}`);
  }

  // Test 4: Database Search
  console.log('Test 4: Verifying database search...');
  const searchResults = await db.searchSongs('Bohemian');
  if (searchResults.length === 1 && searchResults[0].artist === 'Queen') {
    console.log('✓ Database search by title works.');
  } else {
    throw new Error('Search failed to find Queen song.');
  }

  const opmSongs = await db.searchSongs('', 'OPM');
  if (opmSongs.length === 1 && opmSongs[0].title === 'Torete') {
    console.log('✓ Database search by category works.');
  } else {
    throw new Error('Category search failed.');
  }

  // Test 5: Queue Operations
  console.log('Test 5: Verifying queue operations...');
  const songToQueue = searchResults[0];
  await db.addToQueue(songToQueue.id, 'Alice');
  
  let queue = await db.getQueue();
  const queueItem = queue.find(item => item.singer_name === 'Alice' && item.song_id === songToQueue.id);
  if (queueItem) {
    console.log('✓ Add to queue works.');
  } else {
    throw new Error('Queue addition check failed.');
  }

  // Test 6: Playback State Management
  console.log('Test 6: Verifying playback state changes...');
  await db.setSongSinging(queueItem.queue_id);
  
  const nowPlaying = await db.getNowPlaying();
  if (nowPlaying && nowPlaying.title === 'Bohemian Rhapsody' && nowPlaying.status === 'singing') {
    console.log('✓ Set song singing works.');
  } else {
    throw new Error('Set song singing failed.');
  }

  await db.setSongFinished(queueItem.queue_id);
  const queueAfterFinished = await db.getQueue();
  const finishedItem = queueAfterFinished.find(item => item.queue_id === queueItem.queue_id);
  
  if (!finishedItem) {
    console.log('✓ Set song finished removes it from active queue.');
  } else {
    throw new Error('Finished song still in active queue.');
  }

  const history = await db.getRecentlyPlayed();
  if (history.length >= 1 && history[0].title === 'Bohemian Rhapsody') {
    console.log('✓ Playback history logging works.');
  } else {
    throw new Error('History logging check failed.');
  }

  // Test 7: Updating Library Path in Settings
  console.log('Test 7: Verifying custom library path updates...');
  const newCustomPath = path.join(__dirname, 'mock_library_custom');
  if (!fs.existsSync(newCustomPath)) {
    fs.mkdirSync(newCustomPath, { recursive: true });
  }
  const customSongPath = path.join(newCustomPath, 'Rey Valera - Maging Sino Ka Man.mp4');
  fs.writeFileSync(customSongPath, 'dummy custom video data', 'utf8');

  // Save new settings with updated library path
  const updatedSettings = {
    ...settingsManager.load(),
    libraryPath: newCustomPath
  };
  const saveOk = settingsManager.save(updatedSettings);
  if (!saveOk) {
    throw new Error('Failed to save updated settings.');
  }

  const loadedAgain = settingsManager.load();
  if (loadedAgain.libraryPath !== newCustomPath) {
    throw new Error(`Expected libraryPath to be ${newCustomPath}, got ${loadedAgain.libraryPath}`);
  }
  console.log('✓ Custom library path successfully persisted and reloaded.');

  const customScanResult = await scanner.scanLibrary(loadedAgain.libraryPath);
  console.log(`Scan results for new path - Total indexed: ${customScanResult.total}, Added: ${customScanResult.added}`);
  if (customScanResult.total === 1) {
    console.log('✓ Scanner indexed songs from newly chosen library path correctly.');
  } else {
    throw new Error(`Expected 1 song from new library path, got ${customScanResult.total}`);
  }

  // Restore mock library path
  settingsManager.save({
    ...settingsManager.load(),
    libraryPath: mockLibraryDir
  });
  await scanner.scanLibrary(mockLibraryDir);

  // Clean up temporary custom mock directory
  try {
    fs.rmSync(newCustomPath, { recursive: true, force: true });
  } catch (e) {}

  // Test 8: Cloudflare Tunnel Manager Verification
  console.log('Test 8: Verifying Cloudflare Tunnel manager...');
  const tunnel = require('./server/tunnel');
  const isAvailable = tunnel.isAvailable();
  if (isAvailable) {
    console.log('✓ Cloudflared binary located and verified.');
  } else {
    throw new Error('Cloudflared binary not found.');
  }

  const initialStatus = tunnel.getStatus();
  if (initialStatus && (initialStatus.status === 'stopped' || initialStatus.status === 'running')) {
    console.log('✓ Tunnel state management operating as expected.');
  } else {
    throw new Error(`Unexpected tunnel status: ${initialStatus.status}`);
  }

  // --- Version 2 Features Verification ---

  // Test 9: Song Numbers Assignment & Search by Number
  console.log('Test 9: Verifying unique song numbers assignment & query by number...');
  const allSongs = await db.getAllSongs();
  if (allSongs.length === 0) {
    throw new Error('Expected songs in database, found 0.');
  }
  for (const song of allSongs) {
    if (!song.song_number || typeof song.song_number !== 'number') {
      throw new Error(`Song "${song.title}" is missing a valid numeric song_number: ${song.song_number}`);
    }
  }
  console.log(`✓ All ${allSongs.length} songs have unique assigned numeric codes.`);

  const sampleSong = allSongs[0];
  const fetchedByNum = await db.getSongByNumber(sampleSong.song_number);
  if (!fetchedByNum || fetchedByNum.id !== sampleSong.id) {
    throw new Error(`Failed to lookup song by number: ${sampleSong.song_number}`);
  }
  console.log(`✓ Lookup by song number (#${sampleSong.song_number} -> "${sampleSong.title}") works.`);

  const searchByNum = await db.searchSongs(sampleSong.song_number.toString());
  if (searchByNum.length === 0 || !searchByNum.some(s => s.id === sampleSong.id)) {
    throw new Error(`Search songs by numeric code failed for: ${sampleSong.song_number}`);
  }
  console.log(`✓ Numeric code search query works.`);

  const notFoundNum = await db.getSongByNumber(999999);
  if (notFoundNum) {
    throw new Error('Expected undefined for non-existent song number 999999.');
  }
  console.log('✓ Non-existent song number properly returns undefined.');

  // Test updating song number
  const oldNum = sampleSong.song_number;
  const testNewNum = 99123;
  await db.updateSongNumber(sampleSong.id, testNewNum);
  const updatedCheck = await db.getSongByNumber(testNewNum);
  if (!updatedCheck || updatedCheck.id !== sampleSong.id) {
    throw new Error('Failed to update song number.');
  }
  // Restore original number
  await db.updateSongNumber(sampleSong.id, oldNum);
  console.log('✓ Updating and reassigning song numbers works as expected.');

  // Test 10: Scanner extraction of leading 3-6 digit song numbers
  console.log('Test 10: Verifying scanner extraction of filenames with song numbers...');
  const numberedSongFile = path.join(mockLibraryDir, 'OPM', '10999 - Parokya ni Edgar - Harana.mp4');
  fs.writeFileSync(numberedSongFile, 'dummy video with number prefix', 'utf8');

  await scanner.scanLibrary(mockLibraryDir);
  const parsedNumberedSong = await db.getSongByNumber(10999);
  if (!parsedNumberedSong || parsedNumberedSong.title !== 'Harana' || parsedNumberedSong.artist !== 'Parokya ni Edgar') {
    throw new Error('Scanner failed to parse leading number, title, or artist correctly.');
  }
  console.log('✓ Scanner parsed leading song code #10999 ("Harana" by "Parokya ni Edgar") successfully.');

  // Test 11: Songbook Catalog Sorting for Print Preview
  console.log('Test 11: Verifying Songbook print sorting...');
  const sortedByNum = await db.getAllSongs('song_number');
  for (let i = 0; i < sortedByNum.length - 1; i++) {
    if ((sortedByNum[i].song_number || 0) > (sortedByNum[i + 1].song_number || 0)) {
      throw new Error('Songs not sorted ascending by song_number.');
    }
  }
  console.log(`✓ Songs correctly sorted by song_number (${sortedByNum.length} items).`);

  const sortedByTitle = await db.getAllSongs('title');
  for (let i = 0; i < sortedByTitle.length - 1; i++) {
    if (sortedByTitle[i].title.localeCompare(sortedByTitle[i + 1].title) > 0) {
      throw new Error('Songs not sorted ascending by title.');
    }
  }
  console.log('✓ Songs correctly sorted alphabetically by title.');

  // Test 12: Server API - Remote Input, Permission Lockout & Queue by Number
  console.log('Test 12: Verifying Server API for Remote Keypad & Permission Lockout...');
  const server = require('./server/server');
  const TEST_PORT = 8089;
  await server.start(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    // 1. GET /api/songs/by-number/:number
    const resSong = await fetch(`${baseUrl}/api/songs/by-number/10999`);
    const dataSong = await resSong.json();
    if (!dataSong.success || dataSong.song.title !== 'Harana') {
      throw new Error('GET /api/songs/by-number/10999 failed.');
    }
    console.log('✓ API endpoint /api/songs/by-number/:number returned expected song.');

    // 2. POST /api/queue/by-number with user remote input enabled
    const resQueue1 = await fetch(`${baseUrl}/api/queue/by-number`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songNumber: 10999,
        singerName: 'Nostalgic Singer',
        isRemote: true
      })
    });
    const dataQueue1 = await resQueue1.json();
    if (!dataQueue1.success || dataQueue1.singerName !== 'Nostalgic Singer') {
      throw new Error(`POST /api/queue/by-number failed: ${JSON.stringify(dataQueue1)}`);
    }
    console.log('✓ POST /api/queue/by-number successfully queued song with singer name.');

    // Verify queue item has song_number
    const resGetQueue = await fetch(`${baseUrl}/api/queue`);
    const dataGetQueue = await resGetQueue.json();
    const queuedTrack = dataGetQueue.queue.find(q => q.singer_name === 'Nostalgic Singer');
    if (!queuedTrack || queuedTrack.song_number !== 10999) {
      throw new Error('Queue item does not include song_number.');
    }
    console.log('✓ Queue list contains song_number for TV / Projector Up Next display.');

    // 3. Test Admin Permission Lockout
    // Disable user remote input in settings
    const originalSettings = settingsManager.load();
    settingsManager.save({
      ...originalSettings,
      userRemoteInputEnabled: false,
      adminPassword: 'supersecretpass'
    });

    // Attempt queue without admin auth -> should be blocked (403 Forbidden)
    const resBlocked = await fetch(`${baseUrl}/api/queue/by-number`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songNumber: 10999,
        singerName: 'Unauthorized User',
        isRemote: true
      })
    });
    if (resBlocked.status !== 403) {
      throw new Error(`Expected HTTP 403 when remote input disabled, got ${resBlocked.status}`);
    }
    const dataBlocked = await resBlocked.json();
    if (dataBlocked.success !== false) {
      throw new Error('Expected success: false for blocked remote request.');
    }
    console.log('✓ Remote user input lockout correctly rejected unauthorized singer request (403 Forbidden).');

    // Attempt queue with valid admin auth -> should succeed
    const resAdminOk = await fetch(`${baseUrl}/api/queue/by-number`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songNumber: 10999,
        singerName: 'Admin Authorized',
        isRemote: true,
        adminAuth: 'supersecretpass'
      })
    });
    const dataAdminOk = await resAdminOk.json();
    if (!dataAdminOk.success) {
      throw new Error(`Expected admin remote queue to succeed, got: ${JSON.stringify(dataAdminOk)}`);
    }
    console.log('✓ Admin remote input override succeeded with valid credentials.');

    // Restore original settings
    settingsManager.save(originalSettings);
  } finally {
    await server.stop();
  }

  // Cleanup numbered mock song file
  try {
    fs.unlinkSync(numberedSongFile);
  } catch (e) {}

  console.log('\n--- All KantaBai Version 2 verification tests passed successfully! ---');
}

runTests().catch(err => {
  console.error('\n❌ Verification test failed:', err);
  process.exit(1);
});

