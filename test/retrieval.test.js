import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../server/db');
const { searchLocalWorks, insertExternalWork, analyzeSearchQuery } = require('../server/services/worksRepository');
let db;
let previousDbPath;
let sequence;

beforeEach(() => {
  closeDb();
  previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = ':memory:';
  db = getDb();
  // The schema is shared with the application; all search evidence below is synthetic.
  db.exec('DELETE FROM works');
  sequence = 0;
});

afterEach(() => {
  closeDb();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
});

function addWork(fields = {}) {
  return insertExternalWork(db, {
    sourceType: 'retrieval-test',
    kind: 'pair',
    literatureTitle: `合成存档${++sequence}`,
    description: '',
    keywords: [],
    ...fields
  });
}

function resultIds(query) {
  return searchLocalWorks(db, query).map((work) => work.id);
}

test.each(['literatureTitle', 'movieTitle', 'literatureAuthor', 'movieDirector'])(
  'ranks a complete %s ahead of a newer thematic keyword match',
  (field) => {
    const exact = addWork({ [field]: '琉璃剧场' });
    addWork({ keywords: ['琉璃剧场', '后台'], description: '一座琉璃剧场里的装置。' });
    expect(resultIds('《琉璃剧场》')[0]).toBe(exact.id);
  }
);

test('retains an explicit full-title lookup even when the title is a grammatical word', () => {
  const exact = addWork({ literatureTitle: '我们' });
  addWork({ description: '我们在此写下一段话。' });
  expect(resultIds('我们')[0]).toBe(exact.id);
});

test.each([
  ['literatureTitle', '不要关闭灯塔'],
  ['movieTitle', '排除第七码头']
])('retrieves an unquoted %s that begins with an exclusion command', (field, title) => {
  const exact = addWork({ [field]: title });
  addWork({ keywords: [title], description: title });
  expect(resultIds(title)).toEqual([exact.id]);
  expect(analyzeSearchQuery(title).literalQuery).toBe(title);
});

test('keeps a pure exclusion empty when no complete metadata field matches it', () => {
  addWork({ keywords: ['雪'], description: '雪中的码头。' });
  addWork({ keywords: ['晴天', '不要雪'], description: '不要雪，只画晴天。' });
  expect(analyzeSearchQuery('不要雪').terms).toEqual([]);
  expect(resultIds('不要雪')).toEqual([]);
});

test('preserves keyword entries and gives a complete keyword priority over a substring', () => {
  const exact = addWork({ keywords: ['琥珀', '棱镜'] });
  addWork({ keywords: ['棱镜装置', '后台'] });
  expect(resultIds('棱镜')[0]).toBe(exact.id);
});

test('does not create a word by joining separate keyword entries', () => {
  const actual = addWork({ keywords: ['田野'] });
  addWork({ keywords: ['麦田', '野营'] });
  expect(resultIds('田野')).toEqual([actual.id]);
});

test('finds literal words in a sentence longer than twelve characters', () => {
  const relevant = addWork({ keywords: ['钟楼', '彩虹'] });
  addWork({ keywords: ['海浪'] });
  expect(resultIds('我想找描绘钟楼和彩虹同时出现的片段')).toEqual([relevant.id]);
});

test('does not turn characters inside unrelated technical or food words into matches', () => {
  addWork({ keywords: ['电', '诗', '饭', '烤'], description: '电车旁边的诗行与人们的面容。' });
  expect(resultIds('硬件集成电路')).toEqual([]);
  expect(resultIds('烤肉拌饭教程')).toEqual([]);
});

test('requires direct evidence before associated moods can influence ranking', () => {
  const literal = addWork({ keywords: ['雨'] });
  addWork({ keywords: ['伞', '潮湿', '巷弄'], description: '街角的等候。' });
  expect(resultIds('雨')).toEqual([literal.id]);
});

test.each(['', '   ', '！？…——（）', '\t$%🪁+ '])('returns no works for a query without searchable text: %j', (query) => {
  addWork({ keywords: ['月亮', '雪', '青春'] });
  expect(resultIds(query)).toEqual([]);
});

test('retrieves an older relevant work after more than five hundred newer records', () => {
  const relevant = addWork({ keywords: ['紫藤钟楼'] });
  db.exec('BEGIN');
  for (let index = 0; index < 501; index += 1) addWork();
  db.exec('COMMIT');
  expect(resultIds('紫藤钟楼')).toEqual([relevant.id]);
});

test('supports explicit exclusion clauses without adding their words as positive evidence', () => {
  const allowed = addWork({ keywords: ['玻璃', '雕塑'] });
  addWork({ keywords: ['玻璃', '雕塑', '彩虹'] });
  expect(resultIds('玻璃雕塑，但不要彩虹')).toEqual([allowed.id]);
  expect(resultIds('排除彩虹，找玻璃雕塑')).toEqual([allowed.id]);
  expect(analyzeSearchQuery('玻璃雕塑，但不要彩虹').terms).not.toContain('彩虹');
});

test('keeps descriptive negative phrases as positive search text', () => {
  const relevant = addWork({ keywords: ['玻璃'], description: '玻璃灯罩旁放着一张没有寄出的明信片。' });
  for (const query of ['没有寄出的明信片，玻璃灯罩', '没有说出口的心愿，玻璃灯罩']) {
    expect(analyzeSearchQuery(query).excludedTerms).toEqual([]);
    expect(resultIds(query)).toEqual([relevant.id]);
  }
});
