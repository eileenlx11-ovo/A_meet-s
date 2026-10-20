const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db');
const { getWork, getComments } = require('../services/worksRepository');
const { buildSearchResponse } = require('../services/searchService');
const { searchBooks } = require('../services/bookProviders');
const { searchMovies } = require('../services/movieProviders');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const commentSchema = z.object({
  body: z.string().trim().min(1, '评论不能为空。').max(1000, '评论不能超过 1000 字。')
});

router.get('/search', async (req, res, next) => {
  try {
    const data = await buildSearchResponse(getDb(), req.query.q ?? '', {
      externalEnabled: process.env.DISABLE_EXTERNAL_SEARCH !== '1', searchBooks, searchMovies
    });
    res.json(data);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

router.get('/works/:id', (req, res) => {
  const work = getWork(getDb(), Number(req.params.id));
  if (!work) {
    res.status(404).json({ error: '没有找到这条作品记录。' });
    return;
  }
  res.json({ work });
});

router.get('/works/:id/comments', (req, res) => {
  const db = getDb();
  const work = getWork(db, Number(req.params.id));
  if (!work) {
    res.status(404).json({ error: '没有找到这条作品记录。' });
    return;
  }
  res.json({ comments: getComments(db, work.id) });
});

router.post('/works/:id/comments', requireAuth, writeLimiter, validate(commentSchema), (req, res) => {
  const db = getDb();
  const work = getWork(db, Number(req.params.id));
  if (!work) {
    res.status(404).json({ error: '没有找到这条作品记录。' });
    return;
  }
  db.prepare('INSERT INTO comments (work_id, user_id, body) VALUES (?, ?, ?)').run(work.id, req.user.id, req.body.body);
  res.status(201).json({ comments: getComments(db, work.id) });
});

module.exports = router;
