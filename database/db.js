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
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      category TEXT,
      play_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
async function addSong({ title, artist, file_path, category }) {
  const connection = await getDbConnection();
  return connection.run(
    `INSERT OR IGNORE INTO songs (title, artist, file_path, category) VALUES (?, ?, ?, ?)`,
    [title, artist, file_path, category]
  );
}

async function getAllSongs() {
  const connection = await getDbConnection();
  return connection.all('SELECT * FROM songs ORDER BY title ASC');
}

async function searchSongs(query, category) {
  const connection = await getDbConnection();
  let sql = 'SELECT * FROM songs WHERE 1=1';
  const params = [];

  if (query) {
    sql += ' AND (title LIKE ? OR artist LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
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
    sql += ' ORDER BY title ASC';
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
           s.id as song_id, s.title, s.artist, s.file_path, s.category
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
           s.id as song_id, s.title, s.artist, s.file_path, s.category
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
