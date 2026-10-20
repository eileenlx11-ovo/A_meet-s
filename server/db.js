const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { buildEmbedUrl, isSupportedProvider } = require('./services/videoProviders');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
let db;

function getDbPath() {
  return process.env.DB_PATH || path.join(dataDir, 'anchor-shadow.sqlite');
}

function getDb() {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(getDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    initializeSchema(db);
    seedWorks(db);
  }
  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      literature_title TEXT,
      literature_author TEXT,
      quote TEXT,
      movie_title TEXT,
      movie_year INTEGER,
      movie_director TEXT,
      description TEXT NOT NULL,
      external_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS work_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_video_id TEXT NOT NULL,
      embed_url TEXT NOT NULL,
      title TEXT,
      thumbnail_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(requester_id, addressee_id)
    );

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS generated_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      asset_path TEXT,
      preview_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      favorite_book_genres TEXT,
      favorite_movie_genres TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS community_members (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (community_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedWorks(database) {
  const seedPath = path.join(dataDir, 'seed-works.json');
  const works = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insertWork = database.prepare(`
    INSERT INTO works (
      source_type, kind, literature_title, literature_author, quote,
      movie_title, movie_year, movie_director, description, external_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertKeyword = database.prepare('INSERT INTO work_keywords (work_id, keyword) VALUES (?, ?)');
  const insertVideo = database.prepare(`
    INSERT INTO videos (work_id, provider, provider_video_id, embed_url, title, thumbnail_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    database.exec('BEGIN');
    for (const item of works) {
      const existing = database.prepare(`
        SELECT id FROM works
        WHERE COALESCE(literature_title, '') = COALESCE(?, '')
          AND COALESCE(movie_title, '') = COALESCE(?, '')
        LIMIT 1
      `).get(item.literatureTitle || null, item.movieTitle || null);
      if (existing) continue;

      const result = insertWork.run(
        item.sourceType,
        item.kind,
        item.literatureTitle || null,
        item.literatureAuthor || null,
        item.quote || null,
        item.movieTitle || null,
        item.movieYear || null,
        item.movieDirector || null,
        item.description || '',
        item.externalUrl || null
      );
      for (const keyword of item.keywords || []) {
        insertKeyword.run(result.lastInsertRowid, keyword);
      }
      for (const video of item.videos || []) {
        if (!isSupportedProvider(video.provider)) continue;
        const embedUrl = buildEmbedUrl(video.provider, video.providerVideoId);
        if (!embedUrl) continue;
        insertVideo.run(result.lastInsertRowid, video.provider, video.providerVideoId, embedUrl, video.title || null, video.thumbnailUrl || null);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function createPublicId() {
  return `AS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function serializePublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    publicId: user.public_id,
    displayName: user.display_name
  };
}

// Only authentication and the account owner's own profile may include their email.
function serializePrivateUser(user) {
  if (!user) return null;
  return {
    ...serializePublicUser(user),
    email: user.email
  };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  createPublicId,
  serializePublicUser,
  serializePrivateUser,
  // Preserve the existing authentication imports; public responses use serializePublicUser.
  serializeUser: serializePrivateUser,
  closeDb
};
