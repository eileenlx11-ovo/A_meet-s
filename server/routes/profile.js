const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const profileSchema = z.object({
  bio: z.string().trim().max(80, '一句话简介不能超过 80 字。').optional().default(''),
  favoriteBookGenres: z.string().trim().max(120, '喜欢的书籍类型不能超过 120 字。').optional().default(''),
  favoriteMovieGenres: z.string().trim().max(120, '喜欢的电影类型不能超过 120 字。').optional().default('')
});

router.get('/profile/me', requireAuth, (req, res) => {
  const db = getDb();
  const profile = getProfile(db, req.user.id);
  res.json({ profile: mapProfile(req.user, profile) });
});

router.put('/profile/me', requireAuth, writeLimiter, validate(profileSchema), (req, res) => {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_profiles (user_id, bio, favorite_book_genres, favorite_movie_genres, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      bio = excluded.bio,
      favorite_book_genres = excluded.favorite_book_genres,
      favorite_movie_genres = excluded.favorite_movie_genres,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, req.body.bio, req.body.favoriteBookGenres, req.body.favoriteMovieGenres);

  res.json({ profile: mapProfile(req.user, getProfile(db, req.user.id)) });
});

router.get('/profile/me/comments', requireAuth, (req, res) => {
  const db = getDb();
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, w.id AS work_id, w.literature_title, w.movie_title, w.description
    FROM comments c
    JOIN works w ON w.id = c.work_id
    WHERE c.user_id = ? AND c.status = 'visible'
    ORDER BY c.id DESC
  `).all(req.user.id).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    work: {
      id: row.work_id,
      literatureTitle: row.literature_title,
      movieTitle: row.movie_title,
      description: row.description
    }
  }));

  res.json({ comments });
});

function getProfile(db, userId) {
  return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) || {};
}

function mapProfile(user, profile) {
  return {
    // attachUser already converted this account to the API's camelCase fields.
    user,
    bio: profile.bio || '',
    favoriteBookGenres: profile.favorite_book_genres || '',
    favoriteMovieGenres: profile.favorite_movie_genres || '',
    updatedAt: profile.updated_at || null
  };
}

module.exports = router;
