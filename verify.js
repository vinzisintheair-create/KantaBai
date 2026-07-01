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

  console.log('\n--- All KantaBai verification tests passed successfully! ---');
}

runTests().catch(err => {
  console.error('\n❌ Verification test failed:', err);
  process.exit(1);
});
