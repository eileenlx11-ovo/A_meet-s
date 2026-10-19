const express = require('express');
const { z } = require('zod');
const { getDb, serializePublicUser } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const friendRequestSchema = z.object({
  publicId: z.string().trim().min(4, '请输入好友 ID。').max(40, '好友 ID 太长。')
});

router.get('/friend-requests', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fr.id, fr.status, fr.created_at, u.id AS user_id, u.public_id, u.display_name
    FROM friend_requests fr
    JOIN users u ON u.id = fr.requester_id
    WHERE fr.addressee_id = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(req.user.id);
  res.json({ requests: rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    requester: serializePublicUser({ id: row.user_id, public_id: row.public_id, display_name: row.display_name })
  })) });
});

router.post('/friend-requests', requireAuth, writeLimiter, validate(friendRequestSchema), (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM users WHERE public_id = ?').get(req.body.publicId.toUpperCase());
  if (!target) {
    res.status(404).json({ error: '没有找到这个好友 ID。' });
    return;
  }
  if (target.id === req.user.id) {
    res.status(400).json({ error: '不能添加自己。' });
    return;
  }
  if (areFriends(db, req.user.id, target.id)) {
    res.status(409).json({ error: '你们已经是好友。' });
    return;
  }

  const existing = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (existing) {
    res.status(409).json({ error: existing.status === 'pending' ? '已有待处理的好友请求。' : '这条好友请求已处理。' });
    return;
  }

  const result = db.prepare('INSERT INTO friend_requests (requester_id, addressee_id) VALUES (?, ?)').run(req.user.id, target.id);
  res.status(201).json({ requestId: result.lastInsertRowid });
});

router.post('/friend-requests/:id/accept', requireAuth, writeLimiter, (req, res) => {
  updateFriendRequest(req, res, 'accepted');
});

router.post('/friend-requests/:id/reject', requireAuth, writeLimiter, (req, res) => {
  updateFriendRequest(req, res, 'rejected');
});

router.get('/friends', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.public_id, u.display_name
    FROM friend_requests fr
    JOIN users u ON u.id = CASE WHEN fr.requester_id = ? THEN fr.addressee_id ELSE fr.requester_id END
    WHERE fr.status = 'accepted' AND (fr.requester_id = ? OR fr.addressee_id = ?)
    ORDER BY u.display_name
  `).all(req.user.id, req.user.id, req.user.id);
  res.json({ friends: rows.map(serializePublicUser) });
});

function updateFriendRequest(req, res, status) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND addressee_id = ? AND status = ?')
    .get(Number(req.params.id), req.user.id, 'pending');
  if (!request) {
    res.status(404).json({ error: '没有找到待处理的好友请求。' });
    return;
  }
  db.prepare('UPDATE friend_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, request.id);
  res.json({ ok: true });
}

function areFriends(db, userA, userB) {
  return Boolean(db.prepare(`
    SELECT id FROM friend_requests
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
  `).get(userA, userB, userB, userA));
}

module.exports = { router, areFriends };
