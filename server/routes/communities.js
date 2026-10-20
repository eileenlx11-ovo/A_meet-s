const express = require('express');
const { z } = require('zod');
const { getDb, serializePublicUser } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const communitySchema = z.object({
  name: z.string().trim().min(1, '社区名称不能为空。').max(40, '社区名称不能超过 40 字。'),
  description: z.string().trim().max(200, '社区介绍不能超过 200 字。').optional().default('')
});

const postSchema = z.object({
  title: z.string().trim().min(1, '讨论标题不能为空。').max(80, '讨论标题不能超过 80 字。'),
  body: z.string().trim().min(1, '讨论内容不能为空。').max(1200, '讨论内容不能超过 1200 字。')
});

router.get('/communities', (_req, res) => {
  const db = getDb();
  const communities = db.prepare(`
    SELECT c.id, c.name, c.description, c.created_at, u.id AS user_id, u.public_id, u.display_name,
      COUNT(DISTINCT m.user_id) AS member_count,
      COUNT(DISTINCT p.id) AS post_count
    FROM communities c
    JOIN users u ON u.id = c.created_by
    LEFT JOIN community_members m ON m.community_id = c.id
    LEFT JOIN community_posts p ON p.community_id = c.id
    GROUP BY c.id
    ORDER BY c.id DESC
  `).all().map(mapCommunity);
  res.json({ communities });
});

router.post('/communities', requireAuth, writeLimiter, validate(communitySchema), (req, res) => {
  const db = getDb();
  let community;
  try {
    db.exec('BEGIN');
    const result = db.prepare('INSERT INTO communities (name, description, created_by) VALUES (?, ?, ?)')
      .run(req.body.name, req.body.description || null, req.user.id);
    db.prepare('INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)')
      .run(result.lastInsertRowid, req.user.id, 'owner');
    db.exec('COMMIT');
    community = getCommunity(db, result.lastInsertRowid);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.status(201).json({ community });
});

router.post('/communities/:id/join', requireAuth, writeLimiter, (req, res) => {
  const db = getDb();
  const community = getCommunity(db, Number(req.params.id));
  if (!community) {
    res.status(404).json({ error: '没有找到这个梦中人社区。' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id) VALUES (?, ?)')
    .run(community.id, req.user.id);
  res.json({ community: getCommunity(db, community.id) });
});

router.get('/communities/:id/posts', (req, res) => {
  const db = getDb();
  const community = getCommunity(db, Number(req.params.id));
  if (!community) {
    res.status(404).json({ error: '没有找到这个梦中人社区。' });
    return;
  }

  const posts = getCommunityPosts(db, community.id);
  res.json({ community, posts });
});

router.post('/communities/:id/posts', requireAuth, writeLimiter, validate(postSchema), (req, res) => {
  const db = getDb();
  const community = getCommunity(db, Number(req.params.id));
  if (!community) {
    res.status(404).json({ error: '没有找到这个梦中人社区。' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id) VALUES (?, ?)')
    .run(community.id, req.user.id);
  db.prepare('INSERT INTO community_posts (community_id, user_id, title, body) VALUES (?, ?, ?, ?)')
    .run(community.id, req.user.id, req.body.title, req.body.body);

  const posts = getCommunityPosts(db, community.id);
  res.status(201).json({ posts });
});

function getCommunity(db, id) {
  const row = db.prepare(`
    SELECT c.id, c.name, c.description, c.created_at, u.id AS user_id, u.public_id, u.display_name,
      COUNT(DISTINCT m.user_id) AS member_count,
      COUNT(DISTINCT p.id) AS post_count
    FROM communities c
    JOIN users u ON u.id = c.created_by
    LEFT JOIN community_members m ON m.community_id = c.id
    LEFT JOIN community_posts p ON p.community_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);
  return row ? mapCommunity(row) : null;
}

function getCommunityPosts(db, communityId) {
  return db.prepare(`
    SELECT p.id, p.title, p.body, p.created_at, u.id AS user_id, u.public_id, u.display_name
    FROM community_posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.community_id = ?
    ORDER BY p.id DESC
    LIMIT 50
  `).all(communityId).map(mapPost);
}

function mapCommunity(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdAt: row.created_at,
    memberCount: row.member_count,
    postCount: row.post_count,
    creator: serializePublicUser({ id: row.user_id, public_id: row.public_id, display_name: row.display_name })
  };
}

function mapPost(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    author: serializePublicUser({ id: row.user_id, public_id: row.public_id, display_name: row.display_name })
  };
}

module.exports = router;
