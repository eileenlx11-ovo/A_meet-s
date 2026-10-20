import { createRequire } from 'node:module';
import { beforeEach, afterEach, expect, test } from 'vitest';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { createApp } = require('../server/app.js');
const { getDb, closeDb } = require('../server/db.js');
const { insertExternalWork } = require('../server/services/worksRepository.js');
const keys = ['DB_PATH', 'DISABLE_EXTERNAL_SEARCH', 'IMAGE_PROVIDER', 'GOOGLE_BOOKS_API_KEY', 'TMDB_API_KEY', 'OMDB_API_KEY'];
let oldEnv;
let oldFetch;
let externalRequests;

beforeEach(() => {
  closeDb();
  oldEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.DB_PATH = ':memory:';
  delete process.env.DISABLE_EXTERNAL_SEARCH;
  process.env.IMAGE_PROVIDER = 'none';
  for (const key of ['GOOGLE_BOOKS_API_KEY', 'TMDB_API_KEY', 'OMDB_API_KEY']) delete process.env[key];
  oldFetch = global.fetch;
  externalRequests = [];
  global.fetch = async (url) => {
    externalRequests.push(String(url));
    return { ok: true, json: async () => ({ docs: [] }) };
  };
});

afterEach(() => {
  closeDb();
  global.fetch = oldFetch;
  for (const key of keys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
});

test('punctuation-only input stays empty without calling external providers', async () => {
  const response = await request(createApp()).get('/api/search').query({ q: '，。！？《》' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ contractVersion: 2, results: [], partialResults: [], externalResults: [], externalStatus: { books: 'skipped', movies: 'skipped' } });
  expect(externalRequests).toEqual([]);
});

test('explicit exclusions cannot be undone by unfiltered external suggestions', async () => {
  const response = await request(createApp()).get('/api/search').query({ q: '有雪但不要火车' });
  expect(response.status).toBe(200);
  expect(response.body.results.some((work) => work.movieTitle === '情书')).toBe(true);
  expect(response.body.results.some((work) => work.literatureTitle === '安娜·卡列尼娜')).toBe(false);
  expect(response.body.externalStatus).toEqual({ books: 'skipped', movies: 'skipped' });
  expect(externalRequests).toEqual([]);
});

test('a title beginning with an exclusion command still supports an exact local lookup', async () => {
  const exact = insertExternalWork(getDb(), {
    sourceType: 'search-api-test',
    kind: 'literature',
    literatureTitle: '不要擦去极光',
    keywords: []
  });
  const response = await request(createApp()).get('/api/search').query({ q: '不要擦去极光' });
  expect(response.status).toBe(200);
  expect(response.body.results.map((work) => work.id)).toEqual([exact.id]);
  expect(response.body.externalStatus).toEqual({ books: 'skipped', movies: 'skipped' });
  expect(externalRequests).toEqual([]);
});

test('an exclusion without positive evidence or an exact title stays empty and local', async () => {
  const response = await request(createApp()).get('/api/search').query({ q: '不要雪' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ contractVersion: 2, results: [], partialResults: [], externalResults: [], externalStatus: { books: 'skipped', movies: 'skipped' } });
  expect(externalRequests).toEqual([]);
});

test('ordinary positive searches still have the external metadata fallback', async () => {
  const response = await request(createApp()).get('/api/search').query({ q: 'externalmetadatatest' });
  expect(response.status).toBe(200);
  expect(response.body.results).toEqual([]);
  expect(externalRequests).toHaveLength(1);
  expect(externalRequests[0]).toContain('openlibrary.org/search.json');
  expect(response.body.externalStatus.books).toBe('unavailable');
});

// Stage 2 HTTP contract checks. These require the real application dependencies.
test('multi-condition results keep unsupported partial matches in their own group', async () => {
  process.env.DISABLE_EXTERNAL_SEARCH = '1';
  const response = await request(createApp()).get('/api/search').query({ q: '雪地里穿祖母绿裙子' });
  expect(response.status).toBe(200);
  expect(response.body.contractVersion).toBe(2);
  expect(response.body.results).toEqual([]);
  expect(response.body.partialResults).toHaveLength(2);
  expect(response.body.partialResults.every(w => w.match.type === 'partial' && !w.match.sameSceneVerified)).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('procedure-intent queries neither recommend by colour nor call external providers', async () => {
  const response = await request(createApp()).get('/api/search').query({ q: '绿色激光测距仪怎么校准' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ results: [], partialResults: [], externalResults: [], queryPlan: { intent: 'outside_scope' } });
  expect(externalRequests).toEqual([]);
});

test('search rejects overlong or structured query input explicitly', async () => {
  for (const query of [{ q: '雪'.repeat(201) }, { q: { value: '雨夜' } }]) {
    const response = await request(createApp()).get('/api/search').query(query);
    expect(response.status).toBe(400);
  }
  expect(externalRequests).toEqual([]);
});
