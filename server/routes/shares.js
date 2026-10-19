const express = require('express');
const { z } = require('zod');
const { getDb, serializePublicUser } = require('../db');
const { getWork } = require('../services/worksRepository');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const { areFriends } = require('./friends');

const router = express.Router();

const shareSchema = z.object({
  recipientPublicId: z.string().trim().min(4, '请输入好友 ID。').max(40, '好友 ID 太长。'),
  workId: z.coerce.number().int().positive('请选择要分享的作品。'),
  message: z.string().trim().max(300, '分享留言不能超过 300 字。').optional().default('')
});

router.post('/shares', requireAuth, writeLimiter, validate(shareSchema), (req, res) => {
  const db = getDb();
  const recipient = db.prepare('SELECT * FROM users WHERE public_id = ?').get(req.body.recipientPublicId.toUpperCase());
  if (!recipient) {
    res.status(404).json({ error: '没有找到这个好友 ID。' });
    return;
  }
  if (!areFriends(db, req.user.id, recipient.id)) {
    res.status(403).json({ error: '只能分享给已接受的好友。' });
    return;
  }
  const work = getWork(db, req.body.workId);
  if (!work) {
    res.status(404).json({ error: '没有找到这条作品记录。' });
    return;
  }

  const result = db.prepare('INSERT INTO shares (sender_id, recipient_id, work_id, message) VALUES (?, ?, ?, ?)')
    .run(req.user.id, recipient.id, work.id, req.body.message || null);
  res.status(201).json({ shareId: result.lastInsertRowid });
});

router.get('/shares/inbox', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.message, s.created_at, u.id AS sender_id, u.public_id, u.display_name,
      w.id AS work_id, w.literature_title, w.movie_title, w.description
    FROM shares s
    JOIN users u ON u.id = s.sender_id
    JOIN works w ON w.id = s.work_id
    WHERE s.recipient_id = ?
    ORDER BY s.id DESC
  `).all(req.user.id);
  res.json({ shares: rows.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
    sender: serializePublicUser({ id: row.sender_id, public_id: row.public_id, display_name: row.display_name }),
    work: {
      id: row.work_id,
      literatureTitle: row.literature_title,
      movieTitle: row.movie_title,
      description: row.description
    }
  })) });
});

module.exports = router;
