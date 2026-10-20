const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db');
const { analyzeSearchQuery, searchLocalWorks, getWork, insertExternalWork, getComments } = require('../services/worksRepository');
const { searchBooks } = require('../services/bookProviders');
const { searchMovies } = require('../services/movieProviders');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const commentSchema = z.object({
  body: z.string().trim().min(1, '评论不能为空。').max(1000, '评论不能超过 1000 字。')
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const analysis = analyzeSearchQuery(query);
  if (!analysis.literalQuery) {
    res.json({ results: [], externalStatus: { books: 'skipped', movies: 'skipped' } });
    return;
  }

  const db = getDb();
  const localResults = searchLocalWorks(db, query);
  const externalStatus = { books: 'skipped', movies: 'skipped' };
  const externalResults = [];

  // External providers return unfiltered metadata and echo the query in keywords.
  // Keep explicit exclusions local until those providers support verified filters.
  if (localResults.length < 8 && analysis.terms.length > 0 && !analysis.excludedTerms.length && process.env.DISABLE_EXTERNAL_SEARCH !== '1') {
    const [books, movies] = await Promise.all([searchBooks(query), searchMovies(query)]);
    externalStatus.books = books.length > 0 ? 'ok' : 'unavailable';
    externalStatus.movies = movies.length > 0 ? 'ok' : 'unavailable';

    for (const item of [...books, ...movies].slice(0, 10)) {
      externalResults.push(insertExternalWork(db, item));
    }
  }

  const byId = new Map();
  for (const work of [...localResults, ...externalResults]) {
    if (work) byId.set(work.id, work);
  }

  res.json({ results: [...byId.values()], externalStatus });
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
