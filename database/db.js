const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let DB_PATH;
try {
  const { app } = require('electron');
  if (app) {
    DB_PATH = path.join(app.getPath('userData'), 'kantabai.db');
  } else {
    DB_PATH = path.join(__dirname, '..', 'kantabai.db');
  }
} catch (e) {
  DB_PATH = path.join(__dirname, '..', 'kantabai.db');
}
let db = null;

async function getDbConnection() {
  if (db) return db;
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  return db;
}

async function initDb() {
  const connection = await getDbConnection();
  
  // Enable foreign keys
  await connection.run('PRAGMA foreign_keys = ON;');
  
  // Create songs table
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_number INTEGER UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      category TEXT,
      play_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Ensure song_number column exists for existing databases
  const columns = await connection.all('PRAGMA table_info(songs);');
  const hasSongNumber = columns.some(c => c.name === 'song_number');
  if (!hasSongNumber) {
    await connection.run('ALTER TABLE songs ADD COLUMN song_number INTEGER;');
  }
  await connection.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_song_number ON songs(song_number);');

  // Backfill any songs missing a song_number
  const unnumberedSongs = await connection.all('SELECT id FROM songs WHERE song_number IS NULL ORDER BY id ASC');
  if (unnumberedSongs.length > 0) {
    const maxRow = await connection.get('SELECT MAX(song_number) as max_num FROM songs');
    let nextNum = (maxRow && maxRow.max_num && maxRow.max_num >= 10001) ? maxRow.max_num + 1 : 10001;
    for (const s of unnumberedSongs) {
      await connection.run('UPDATE songs SET song_number = ? WHERE id = ?', [nextNum, s.id]);
      nextNum++;
    }
    console.log(`Backfilled ${unnumberedSongs.length} songs with unique song numbers starting at ${10001}.`);
  }

  // Create queue table
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      singer_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'singing', 'finished'
      sort_order INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );
  `);

  // Create history table
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      singer_name TEXT NOT NULL,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
    );
  `);

  console.log('SQLite database initialized successfully.');
  return connection;
}

// Songs CRUD
async function addSong({ title, artist, file_path, category, song_number }) {
  const connection = await getDbConnection();

  // If song already exists by file_path
  const existing = await connection.get('SELECT * FROM songs WHERE file_path = ?', [file_path]);
  if (existing) {
    if (song_number && !existing.song_number) {
      const taken = await connection.get('SELECT id FROM songs WHERE song_number = ? AND id != ?', [song_number, existing.id]);
      if (!taken) {
        await connection.run('UPDATE songs SET song_number = ? WHERE id = ?', [song_number, existing.id]);
      }
      return connection.get('SELECT * FROM songs WHERE id = ?', [existing.id]);
    }
    return existing;
  }

  // Determine unique song_number
  let finalNumber = parseInt(song_number, 10);
  if (isNaN(finalNumber) || finalNumber <= 0) {
    const maxRow = await connection.get('SELECT MAX(song_number) as max_num FROM songs');
    finalNumber = (maxRow && maxRow.max_num && maxRow.max_num >= 10001) ? maxRow.max_num + 1 : 10001;
  } else {
    // If requested number is already taken, assign next available
    const taken = await connection.get('SELECT id FROM songs WHERE song_number = ?', [finalNumber]);
    if (taken) {
      const maxRow = await connection.get('SELECT MAX(song_number) as max_num FROM songs');
      finalNumber = (maxRow && maxRow.max_num && maxRow.max_num >= 10001) ? maxRow.max_num + 1 : 10001;
    }
  }

  await connection.run(
    `INSERT OR IGNORE INTO songs (song_number, title, artist, file_path, category) VALUES (?, ?, ?, ?, ?)`,
    [finalNumber, title, artist, file_path, category]
  );
  return connection.get('SELECT * FROM songs WHERE file_path = ?', [file_path]);
}

async function getAllSongs(sortBy = 'song_number') {
  const connection = await getDbConnection();
  if (sortBy === 'title') {
    return connection.all('SELECT * FROM songs ORDER BY title ASC, artist ASC');
  } else if (sortBy === 'artist') {
    return connection.all('SELECT * FROM songs ORDER BY artist ASC, title ASC');
  }
  return connection.all('SELECT * FROM songs ORDER BY song_number ASC, title ASC');
}

async function getSongByNumber(songNumber) {
  const connection = await getDbConnection();
  const num = parseInt(songNumber, 10);
  if (isNaN(num)) return null;
  return connection.get('SELECT * FROM songs WHERE song_number = ?', [num]);
}

async function updateSongNumber(songId, songNumber) {
  const connection = await getDbConnection();
  const num = parseInt(songNumber, 10);
  if (isNaN(num) || num <= 0) throw new Error('Invalid song number');
  const existing = await connection.get('SELECT id FROM songs WHERE song_number = ? AND id != ?', [num, songId]);
  if (existing) {
    throw new Error(`Song number ${num} is already assigned to another song.`);
  }
  await connection.run('UPDATE songs SET song_number = ? WHERE id = ?', [num, songId]);
  return connection.get('SELECT * FROM songs WHERE id = ?', [songId]);
}

async function searchSongs(query, category) {
  const connection = await getDbConnection();
  let sql = 'SELECT * FROM songs WHERE 1=1';
  const params = [];

  if (query) {
    sql += ' AND (title LIKE ? OR artist LIKE ? OR CAST(song_number AS TEXT) LIKE ?)';
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  if (category && category !== 'All Songs') {
    if (category === 'Favorites') {
      sql += ' AND play_count > 0'; // Mocking Favorites as songs with play count > 0
    } else if (category === 'Recently Played') {
      sql = `SELECT DISTINCT s.* FROM songs s JOIN history h ON s.id = h.song_id ORDER BY h.played_at DESC LIMIT 50`;
      return connection.all(sql);
    } else if (category === 'Most Played') {
      sql += ' AND play_count > 0 ORDER BY play_count DESC';
    } else if (category === 'Recently Added') {
      sql += ' ORDER BY created_at DESC';
    } else {
      sql += ' AND category = ?';
      params.push(category);
    }
  } else {
    sql += ' ORDER BY song_number ASC, title ASC';
  }

  return connection.all(sql, params);
}

// Queue operations
async function addToQueue(songId, singerName) {
  const connection = await getDbConnection();
  
  // Find max sort_order
  const row = await connection.get('SELECT MAX(sort_order) as max_order FROM queue');
  const nextOrder = (row && row.max_order !== null) ? row.max_order + 1 : 0;
  
  return connection.run(
    'INSERT INTO queue (song_id, singer_name, sort_order) VALUES (?, ?, ?)',
    [songId, singerName, nextOrder]
  );
}

async function getQueue() {
  const connection = await getDbConnection();
  return connection.all(`
    SELECT q.id as queue_id, q.singer_name, q.status, q.sort_order, q.added_at,
           s.id as song_id, s.song_number, s.title, s.artist, s.file_path, s.category
    FROM queue q
    JOIN songs s ON q.song_id = s.id
    WHERE q.status != 'finished'
    ORDER BY q.sort_order ASC
  `);
}

async function updateQueueOrder(orders) {
  const connection = await getDbConnection();
  await connection.run('BEGIN TRANSACTION;');
  try {
    for (const item of orders) {
      // item should be { queue_id, sort_order }
      await connection.run(
        'UPDATE queue SET sort_order = ? WHERE id = ?',
        [item.sort_order, item.queue_id]
      );
    }
    await connection.run('COMMIT;');
    return true;
  } catch (err) {
    await connection.run('ROLLBACK;');
    throw err;
  }
}

async function removeFromQueue(queueId) {
  const connection = await getDbConnection();
  return connection.run('DELETE FROM queue WHERE id = ?', [queueId]);
}

async function clearQueue() {
  const connection = await getDbConnection();
  return connection.run("DELETE FROM queue WHERE status != 'singing'");
}

async function getNowPlaying() {
  const connection = await getDbConnection();
  return connection.get(`
    SELECT q.id as queue_id, q.singer_name, q.status, q.added_at,
           s.id as song_id, s.song_number, s.title, s.artist, s.file_path, s.category
    FROM queue q
    JOIN songs s ON q.song_id = s.id
    WHERE q.status = 'singing'
    LIMIT 1
  `);
}

async function setSongSinging(queueId) {
  const connection = await getDbConnection();
  // First, set any current singing to finished
  await connection.run("UPDATE queue SET status = 'finished' WHERE status = 'singing'");
  // Then set target to singing
  return connection.run("UPDATE queue SET status = 'singing' WHERE id = ?", [queueId]);
}

async function setSongFinished(queueId) {
  const connection = await getDbConnection();
  const queueItem = await connection.get('SELECT * FROM queue WHERE id = ?', [queueId]);
  if (queueItem) {
    // Increment song play count
    await connection.run('UPDATE songs SET play_count = play_count + 1 WHERE id = ?', [queueItem.song_id]);
    // Add to history
    await connection.run(
      'INSERT INTO history (song_id, singer_name) VALUES (?, ?)',
      [queueItem.song_id, queueItem.singer_name]
    );
  }
  return connection.run("UPDATE queue SET status = 'finished' WHERE id = ?", [queueId]);
}

async function getRecentlyPlayed(limit = 10) {
  const connection = await getDbConnection();
  return connection.all(`
    SELECT DISTINCT s.*, h.played_at 
    FROM songs s 
    JOIN history h ON s.id = h.song_id 
    ORDER BY h.played_at DESC 
    LIMIT ?
  `, [limit]);
}

module.exports = {
  initDb,
  getDbConnection,
  addSong,
  getAllSongs,
  getSongByNumber,
  updateSongNumber,
  searchSongs,
  addToQueue,
  getQueue,
  updateQueueOrder,
  removeFromQueue,
  clearQueue,
  getNowPlaying,
  setSongSinging,
  setSongFinished,
  getRecentlyPlayed
};
