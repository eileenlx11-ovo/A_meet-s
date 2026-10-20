import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, test } from 'vitest';
import request from 'supertest';

// Match the server's CommonJS module instance so cleanup closes its actual database.
const require = createRequire(import.meta.url);
const { createApp } = require('../server/app.js');
const { closeDb } = require('../server/db.js');

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const envKeys = ['DB_PATH', 'DISABLE_EXTERNAL_SEARCH', 'IMAGE_PROVIDER', 'NODE_ENV'];
let previousEnv;
let fixturePaths;

beforeEach(() => {
  closeDb();
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  fixturePaths = [];
  process.env.DB_PATH = ':memory:';
  process.env.DISABLE_EXTERNAL_SEARCH = '1';
  process.env.IMAGE_PROVIDER = 'none';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  closeDb();
  for (const fixturePath of fixturePaths) {
    fs.rmSync(fixturePath, { recursive: true, force: true });
  }
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

async function register(agent, displayName, email) {
  const response = await agent.post('/api/auth/register').send({
    displayName,
    email,
    password: 'synthetic-password-123'
  });
  expect(response.status).toBe(201);
  return response.body.user;
}

function publicIdentity(user) {
  return { id: user.id, publicId: user.publicId, displayName: user.displayName };
}

test('serves the existing pages and assets without exposing a real synthetic database or backend files', async () => {
  const databaseDir = fs.mkdtempSync(path.join(rootDir, 'data', 'backend-regressions-'));
  fixturePaths.push(databaseDir);
  process.env.DB_PATH = path.join(databaseDir, 'synthetic.sqlite');

  const app = createApp();
  await register(request.agent(app), '静态边界测试用户', 'static@example.test');
  // Use an actual populated SQLite file inside the old static root, not an absent path.
  expect(fs.readFileSync(process.env.DB_PATH).subarray(0, 15).toString()).toBe('SQLite format 3');

  const pages = ['/', '/index.html', '/search.html', '/work.html', '/login.html', '/profile.html', '/community.html', '/friends.html'];
  for (const page of pages) {
    const response = await request(app).get(page);
    expect(response.status, page).toBe(200);
    expect(response.headers['content-type'], page).toMatch(/^text\/html/);
    expect(response.text, page).toMatch(/<html\b/i);
  }

  for (const [asset, contentType] of [['/css/style.css', /text\/css/], ['/js/api-client.js', /javascript/]]) {
    const response = await request(app).get(asset);
    expect(response.status, asset).toBe(200);
    expect(response.headers['content-type'], asset).toMatch(contentType);
  }

  const generatedDir = path.join(rootDir, 'assets', 'generated-images');
  fs.mkdirSync(generatedDir, { recursive: true });
  const imageName = `backend-regressions-${randomUUID()}.png`;
  const imagePath = path.join(generatedDir, imageName);
  fixturePaths.push(imagePath);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X0AAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(imagePath, png);
  const image = await request(app).get(`/assets/generated-images/${imageName}`);
  expect(image.status).toBe(200);
  expect(image.headers['content-type']).toMatch(/^image\/png/);
  expect(image.body).toEqual(png);

  const databaseUrl = `/${path.relative(rootDir, process.env.DB_PATH).split(path.sep).join('/')}`;
  const privatePaths = [
    databaseUrl,
    '/data/seed-works.json',
    '/server/app.js',
    '/server/db.js',
    '/package.json',
    '/package-lock.json',
    '/vitest.config.js',
    '/test/api.test.js',
    '/.env.example',
    '/css/..%2fdata/seed-works.json',
    '/js/..%2fserver/app.js',
    '/assets/generated-images/..%2f..%2fserver/app.js'
  ];
  for (const privatePath of privatePaths) {
    const response = await request(app).get(privatePath);
    expect(response.status, privatePath).toBe(404);
  }
});

test('preserves the signed-in display name and public ID when loading and saving a profile', async () => {
  const agent = request.agent(createApp());
  const user = await register(agent, '雨夜读者', 'profile@example.test');

  const before = await agent.get('/api/profile/me');
  expect(before.status).toBe(200);
  expect(before.body.profile.user).toEqual(user);

  const profileFields = {
    bio: '喜欢旅行、文学和旧电影。',
    favoriteBookGenres: '旅行文学',
    favoriteMovieGenres: '纪录片'
  };
  const save = await agent.put('/api/profile/me').send(profileFields);
  expect(save.status).toBe(200);
  expect(save.body.profile).toMatchObject(profileFields);
  expect(save.body.profile.user).toEqual(user);

  const after = await agent.get('/api/profile/me');
  expect(after.status).toBe(200);
  expect(after.body.profile).toMatchObject(profileFields);
  expect(after.body.profile.user).toEqual(user);
});

test('keeps community identities public while retaining the account owner email in auth/me', async () => {
  const app = createApp();
  const owner = request.agent(app);
  const poster = request.agent(app);
  const ownerUser = await register(owner, '读书会创建者', 'owner@example.test');
  const posterUser = await register(poster, '讨论参与者', 'poster@example.test');

  const create = await owner.post('/api/communities').send({ name: '旅行读书会', description: '分享旅途与阅读。' });
  expect(create.status).toBe(201);
  expect(create.body.community.creator).toEqual(publicIdentity(ownerUser));

  const communityId = create.body.community.id;
  const post = await poster.post(`/api/communities/${communityId}/posts`).send({ title: '旅途中的书', body: '你最近在读哪本书？' });
  expect(post.status).toBe(201);
  expect(post.body.posts[0].author).toEqual(publicIdentity(posterUser));

  const communities = await request(app).get('/api/communities');
  expect(communities.status).toBe(200);
  expect(communities.body.communities[0].creator).toEqual(publicIdentity(ownerUser));
  expect(communities.text).not.toContain('email');
  expect(communities.text).not.toContain(ownerUser.email);

  const posts = await request(app).get(`/api/communities/${communityId}/posts`);
  expect(posts.status).toBe(200);
  expect(posts.body.community.creator).toEqual(publicIdentity(ownerUser));
  expect(posts.body.posts[0].author).toEqual(publicIdentity(posterUser));
  expect(posts.text).not.toContain('email');
  expect(posts.text).not.toContain(posterUser.email);

  const me = await owner.get('/api/auth/me');
  expect(me.status).toBe(200);
  expect(me.body.user).toEqual(ownerUser);
  expect(me.body.user.email).toBe('owner@example.test');
});

test('uses public identities in friend requests, friend lists, and received shares', async () => {
  const app = createApp();
  const sender = request.agent(app);
  const recipient = request.agent(app);
  const senderUser = await register(sender, '分享者', 'sender@example.test');
  const recipientUser = await register(recipient, '收件人', 'recipient@example.test');

  const sendRequest = await sender.post('/api/friend-requests').send({ publicId: recipientUser.publicId });
  expect(sendRequest.status).toBe(201);
  const pending = await recipient.get('/api/friend-requests');
  expect(pending.status).toBe(200);
  expect(pending.body.requests[0].requester).toEqual(publicIdentity(senderUser));

  const accept = await recipient.post(`/api/friend-requests/${sendRequest.body.requestId}/accept`);
  expect(accept.status).toBe(200);
  const friends = await sender.get('/api/friends');
  expect(friends.status).toBe(200);
  expect(friends.body.friends).toEqual([publicIdentity(recipientUser)]);

  const share = await sender.post('/api/shares').send({ recipientPublicId: recipientUser.publicId, workId: 1, message: '一起读读看。' });
  expect(share.status).toBe(201);
  const inbox = await recipient.get('/api/shares/inbox');
  expect(inbox.status).toBe(200);
  expect(inbox.body.shares[0].sender).toEqual(publicIdentity(senderUser));
  expect(inbox.body.shares[0].message).toBe('一起读读看。');
});
