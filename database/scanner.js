const fs = require('fs');
const path = require('path');
const db = require('./db');

const SUPPORTED_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.webm', '.mpeg'];

// List of standard categories
const CATEGORIES = [
  'English', 'OPM', 'Pop', 'Rock', 'Ballads', 'Love Songs', 
  'Disney', 'Christmas', 'KPOP', 'Japanese', 'Chinese'
];

function parseFilename(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext).trim();
  
  let artist = 'Unknown Artist';
  let title = base;

  if (base.includes('-')) {
    const parts = base.split('-');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join('-').trim();
    }
  }

  return { artist, title };
}

function getFilesRecursively(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

async function scanLibrary(libraryPath) {
  if (!libraryPath || !fs.existsSync(libraryPath)) {
    console.log('Library path not configured or does not exist:', libraryPath);
    return { added: 0, removed: 0, total: 0 };
  }

  console.log(`Scanning library at: ${libraryPath}`);
  const absoluteFiles = getFilesRecursively(libraryPath);
  
  const dbConnection = await db.getDbConnection();
  
  // Get all indexed songs from DB
  const indexedSongs = await dbConnection.all('SELECT id, file_path FROM songs');
  const indexedPaths = new Map(indexedSongs.map(s => [s.file_path, s.id]));

  let added = 0;
  let total = 0;
  const currentRelativePaths = new Set();

  for (const absPath of absoluteFiles) {
    // Save as relative path
    const relativePath = path.relative(libraryPath, absPath).replace(/\\/g, '/');
    currentRelativePaths.add(relativePath);
    total++;

    if (!indexedPaths.has(relativePath)) {
      // Parse file name for metadata
      const filename = path.basename(absPath);
      const { artist, title } = parseFilename(filename);

      // Determine category based on parent folder name if it matches, else default to "Pop"
      let category = 'Pop';
      const parts = relativePath.split('/');
      if (parts.length > 1) {
        const folderName = parts[0];
        const matchedCategory = CATEGORIES.find(c => c.toLowerCase() === folderName.toLowerCase());
        if (matchedCategory) {
          category = matchedCategory;
        } else if (folderName.toUpperCase() === 'OPM') {
          category = 'OPM';
        }
      }

      await db.addSong({
        title,
        artist,
        file_path: relativePath,
        category
      });
      added++;
    }
  }

  // Remove files that no longer exist
  let removed = 0;
  for (const song of indexedSongs) {
    if (!currentRelativePaths.has(song.file_path)) {
      await dbConnection.run('DELETE FROM songs WHERE id = ?', [song.id]);
      removed++;
    }
  }

  const finalCountRow = await dbConnection.get('SELECT COUNT(*) as count FROM songs');
  const finalCount = finalCountRow ? finalCountRow.count : 0;

  console.log(`Scan complete. Added: ${added}, Removed: ${removed}, Total Indexed: ${finalCount}`);
  return { added, removed, total: finalCount };
}

module.exports = {
  scanLibrary
};
