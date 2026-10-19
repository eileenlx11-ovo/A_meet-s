import request from 'supertest';
import { createRequire } from 'node:module';

// Use the same CommonJS module instance as the routes so cleanup closes the
// connection the app actually used, including when Vitest transforms imports.
const require = createRequire(import.meta.url);
const { createApp } = require('../server/app.js');
const { closeDb } = require('../server/db.js');

function setupTestEnv() {
  process.env.DB_PATH = ':memory:';
  process.env.DISABLE_EXTERNAL_SEARCH = '1';
  process.env.IMAGE_PROVIDER = 'none';
}

function cleanupTestEnv() {
  closeDb();
  delete process.env.DB_PATH;
  delete process.env.DISABLE_EXTERNAL_SEARCH;
  delete process.env.IMAGE_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  delete global.__ANCHOR_SHADOW_IMAGE_PROVIDER_FAKE__;
}

test('searches seeded works', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const response = await request(app).get('/api/search?q=雨夜');
    expect(response.status).toBe(200);
    expect(response.body.results.some((work) => work.movieTitle === '花样年华')).toBe(true);
  } finally {
    cleanupTestEnv();
  }
});

test('registers and returns current user', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const agent = request.agent(app);
    const register = await agent.post('/api/auth/register').send({
      displayName: '读者甲',
      email: 'a@example.com',
      password: 'password123'
    });
    expect(register.status).toBe(201);
    expect(register.body.user.publicId).toMatch(/^AS-/);

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.email).toBe('a@example.com');
  } finally {
    cleanupTestEnv();
  }
});

test('requires login to comment', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const response = await request(app).post('/api/works/1/comments').send({ body: '很好。' });
    expect(response.status).toBe(401);
  } finally {
    cleanupTestEnv();
  }
});

test('prevents sharing before friendship is accepted', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const a = request.agent(app);
    const b = request.agent(app);

    await a.post('/api/auth/register').send({ displayName: '甲', email: 'a@example.com', password: 'password123' });
    const bRegister = await b.post('/api/auth/register').send({ displayName: '乙', email: 'b@example.com', password: 'password123' });
    await a.post('/api/auth/login').send({ email: 'a@example.com', password: 'password123' });

    const share = await a.post('/api/shares').send({
      recipientPublicId: bRegister.body.user.publicId,
      workId: 1,
      message: '看看这个。'
    });
    expect(share.status).toBe(403);
  } finally {
    cleanupTestEnv();
  }
});

test('reports image generation unavailable when provider is missing', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      displayName: '读者丙',
      email: 'c@example.com',
      password: 'password123'
    });

    const response = await agent.post('/api/works/1/images').send({ type: 'ticket', style: '复古胶片' });
    expect(response.status).toBe(503);
  } finally {
    cleanupTestEnv();
  }
});

test('creates generated image records with a fake provider', async () => {
  setupTestEnv();
  try {
    global.__ANCHOR_SHADOW_IMAGE_PROVIDER_FAKE__ = () => ({
      provider: 'gemini',
      model: 'fake-model',
      assetPath: 'D:/dev/Anchor&Shadow/assets/generated-images/fake.png',
      previewUrl: '/assets/generated-images/fake.png'
    });
    process.env.IMAGE_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';

    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      displayName: '读者丁',
      email: 'd@example.com',
      password: 'password123'
    });

    const response = await agent.post('/api/works/1/images').send({ type: 'poster', style: '暗房海报' });
    expect(response.status).toBe(201);
    expect(response.body.image.previewUrl).toContain('/assets/generated-images/');
  } finally {
    cleanupTestEnv();
  }
});

test('updates profile and lists user comments', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      displayName: '读者戊',
      email: 'e@example.com',
      password: 'password123'
    });

    const update = await agent.put('/api/profile/me').send({
      bio: '喜欢雨夜和旧电影。',
      favoriteBookGenres: '意识流、南美文学',
      favoriteMovieGenres: '黑色电影、老港片'
    });
    expect(update.status).toBe(200);
    expect(update.body.profile.bio).toBe('喜欢雨夜和旧电影。');

    await agent.post('/api/works/1/comments').send({ body: '这一段很有画面感。' });
    const comments = await agent.get('/api/profile/me/comments');
    expect(comments.status).toBe(200);
    expect(comments.body.comments[0].work.id).toBe(1);
    expect(comments.body.comments[0].body).toBe('这一段很有画面感。');
  } finally {
    cleanupTestEnv();
  }
});

test('creates community and posts discussion', async () => {
  setupTestEnv();
  try {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      displayName: '读者己',
      email: 'f@example.com',
      password: 'password123'
    });

    const create = await agent.post('/api/communities').send({
      name: '雨夜读书会',
      description: '讨论雨夜、街灯和克制的爱情。'
    });
    expect(create.status).toBe(201);

    const post = await agent.post(`/api/communities/${create.body.community.id}/posts`).send({
      title: '那盏路灯为什么难忘？',
      body: '我觉得它像没有说出口的话。'
    });
    expect(post.status).toBe(201);
    expect(post.body.posts[0].title).toBe('那盏路灯为什么难忘？');
  } finally {
    cleanupTestEnv();
  }
});
