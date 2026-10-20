const { safeVideo } = require('./videoProviders');
const { buildQueryPlan, explainWork } = require('./queryEvidence');
const { attachContentEvidence } = require('./contentEvidence');

// These are loose associations, not interchangeable meanings. They may only
// reorder records that already have literal evidence for the user's query.
const relatedTermGroups = [
  ['雨', '雨夜', '下雨', '雨天', '潮湿', '路灯', '巷弄', '伞'],
  ['雪', '冬天', '冬日', '寒冷', '白色', '山', '离别'],
  ['夏日', '夏天', '盛夏', '阳光', '炎热', '庄园', '绿裙子'],
  ['绿', '绿色', '祖母绿', '绿裙子', '草坪', '欲望'],
  ['红', '红色', '暗红', '旗袍', '暧昧', '香港'],
  ['孤独', '寂寞', '城市', '夜晚', '霓虹', '失眠'],
  ['青春', '暗恋', '信', '遗憾', '回忆', '校园'],
  ['海', '海边', '海浪', '蓝色', '夏天', '告别'],
  ['战争', '废墟', '逃亡', '历史', '时代', '苦难'],
  ['童话', '粉色', '酒店', '荒诞', '对称', '甜美'],
  ['爵士', '派对', '金色', '繁华', '纽约', '烟花'],
  ['雾', '清晨', '荒野', '古典', '告白', '散步'],
  ['火车', '旅行', '远方', '车站', '离别', '重逢'],
  ['月亮', '月光', '夜', '梦', '诗意', '乡愁'],
  ['花', '玫瑰', '花园', '爱情', '温柔', '春天']
];

const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stopWords = new Set([
  '的', '了', '着', '过', '地', '得', '在', '有', '是', '和', '与', '及', '或', '也', '都',
  '但', '但是', '不过', '而', '却', '只', '把', '被', '让', '对', '里', '上', '中',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那', '这个', '那个',
  '这些', '那些', '一个', '一些', '一部', '一本', '一段', '一下', '一帧',
  '想', '我想', '想要', '想看', '找', '寻找', '查找', '搜索', '检索', '看看',
  '可以', '请', '帮', '帮我', '有没有', '关于', '以及', '并且', '没有',
  '作品', '内容', '画面', '镜头', '片段', '场景', '电影', '书籍', '文字',
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'with', 'find', 'show', 'me'
]);

function mapWork(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceType: row.source_type,
    kind: row.kind,
    literatureTitle: row.literature_title,
    literatureAuthor: row.literature_author,
    quote: row.quote,
    movieTitle: row.movie_title,
    movieYear: row.movie_year,
    movieDirector: row.movie_director,
    description: row.description,
    externalUrl: row.external_url,
    createdAt: row.created_at
  };
}

function getKeywords(db, workId) {
  return db.prepare('SELECT keyword FROM work_keywords WHERE work_id = ? ORDER BY keyword').all(workId).map((row) => row.keyword);
}

function getVideos(db, workId) {
  return db.prepare('SELECT * FROM videos WHERE work_id = ? ORDER BY id').all(workId).map(safeVideo).filter(Boolean);
}

function getKeywordsForWorks(db) {
  const rows = db.prepare(`
    SELECT work_id, keyword
    FROM work_keywords
    ORDER BY keyword
  `).all();
  return groupRows(rows, 'work_id', 'keyword');
}

function getVideosForWorks(db, workIds) {
  if (!workIds.length) return new Map();
  const rows = db.prepare(`
    SELECT *
    FROM videos
    WHERE work_id IN (${placeholders(workIds)})
    ORDER BY id
  `).all(...workIds);
  const videosByWork = new Map();
  for (const row of rows) {
    const video = safeVideo(row);
    if (!video) continue;
    if (!videosByWork.has(row.work_id)) videosByWork.set(row.work_id, []);
    videosByWork.get(row.work_id).push(video);
  }
  return videosByWork;
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function groupRows(rows, keyName, valueName) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row[keyName])) grouped.set(row[keyName], []);
    grouped.get(row[keyName]).push(row[valueName]);
  }
  return grouped;
}

function hydrateWork(db, row) {
  const work = mapWork(row);
  if (!work) return null;
  work.keywords = getKeywords(db, work.id);
  work.videos = getVideos(db, work.id);
  return attachContentEvidence(work);
}

function searchLocalWorks(db, query) {
  const analysis = analyzeSearchQuery(query);
  if (!analysis.literalQuery) return [];

  // Rank the complete collection before limiting the response. Filtering the
  // newest 500 records first silently hid older works as the collection grew.
  const rows = db.prepare('SELECT * FROM works ORDER BY id DESC').all();
  const keywordsByWork = getKeywordsForWorks(db);

  const scored = rows
    .map((row) => {
      const work = mapWork(row);
      work.keywords = keywordsByWork.get(work.id) || [];
      return { work, ...scoreWork(work, analysis) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.metadataRank - a.metadataRank || b.score - a.score || b.work.id - a.work.id)
    .slice(0, 30);

  const videosByWork = getVideosForWorks(db, scored.map((item) => item.work.id));
  return scored.map((item) => ({
    ...item.work,
    videos: videosByWork.get(item.work.id) || []
  }));
}

// Stage-2 public contract. The legacy searchLocalWorks above remains a
// candidate-retrieval baseline; clients must use this function to distinguish
// all parsed text conditions from incomplete or unparsed suggestions.
function searchLocalWorksDetailed(db, query) {
  const analysis = analyzeSearchQuery(query);
  const rows = db.prepare('SELECT * FROM works ORDER BY id DESC').all();
  const keywords = getKeywordsForWorks(db);
  const works = rows.map((row) => ({ ...mapWork(row), keywords: keywords.get(row.id) || [] }));
  const plan = buildQueryPlan(query, analysis, works);
  const ranked = works.map((work) => ({ work, match: explainWork(work, plan), ...scoreWork(work, analysis) }))
    .filter((item) => item.match)
    .sort((a, b) => b.metadataRank - a.metadataRank || b.score - a.score || b.work.id - a.work.id);
  const full = ranked.filter((item) => item.match.type !== 'partial');
  const partial = ranked.filter((item) => item.match.type === 'partial');
  const selected = [...full.slice(0, 30), ...partial.slice(0, 12)];
  const videos = getVideosForWorks(db, selected.map((item) => item.work.id));
  const mapResult = (item) => attachContentEvidence({ ...item.work, match: item.match, videos: videos.get(item.work.id) || [] });
  return { contractVersion: 2, queryPlan: plan,
    counts: { allTextConditions: full.length, partial: partial.length },
    results: full.slice(0, 30).map(mapResult), partialResults: partial.slice(0, 12).map(mapResult) };
}

function expandSearchTerms(query) {
  return analyzeSearchQuery(query).terms;
}

function analyzeSearchQuery(query) {
  const exclusions = [];
  // Only explicit command clauses are exclusions. Descriptions such as
  // “没有寄出的信” and “没有说出口” retain their ordinary search meaning.
  const positiveQuery = String(query || '').replace(
    /(?:^|[,，;；。!?！？\n]|但是|不过|但)\s*(?:不要|排除)\s*([^,，;；。!?！？\n]+)/gu,
    (_match, clause) => {
      exclusions.push(clause);
      return ' ';
    }
  ).trim();
  const terms = extractLiteralTerms(positiveQuery);
  const relatedTerms = new Set();
  for (const group of relatedTermGroups) {
    if (group.some((word) => terms.includes(normalize(word)))) {
      for (const word of group) {
        const term = normalize(word);
        if (!terms.includes(term)) relatedTerms.add(term);
      }
    }
  }

  return {
    literalQuery: normalize(query),
    positiveQuery,
    terms,
    excludedTerms: [...new Set(exclusions.flatMap(extractLiteralTerms))],
    relatedTerms: [...relatedTerms]
  };
}

function extractLiteralTerms(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase();
  const whole = normalize(text);
  if (!whole) return [];

  // A complete query can itself be a title (including a word such as “我们”).
  // Stop words are removed from sentence fragments, not from that lookup.
  const terms = new Set([whole]);
  const words = [...wordSegmenter.segment(text)].filter((part) => part.isWordLike);
  for (let index = 0; index < words.length; index += 1) {
    const part = words[index];
    const term = normalize(part.segment);
    if (!term || stopWords.has(term)) continue;

    // ICU can split an unfamiliar compound into single characters. Do not
    // search each fragment; keep a single character only at an explicit word
    // boundary or next to a grammatical word, and score it conservatively.
    const before = text[part.index - 1] || '';
    const after = text[part.index + part.segment.length] || '';
    const separated = /[\s\p{P}\p{S}]/u.test(before) || /[\s\p{P}\p{S}]/u.test(after);
    const grammaticalBoundary = stopWords.has(normalize(words[index - 1]?.segment))
      || stopWords.has(normalize(words[index + 1]?.segment));
    if (term.length > 1 || whole === term || separated || grammaticalBoundary) terms.add(term);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

function scoreWork(work, analysis) {
  const keywords = [...new Set((work.keywords || []).map(normalize).filter(Boolean))];
  const metadata = [work.literatureTitle, work.literatureAuthor, work.movieTitle, work.movieDirector].map(normalize).filter(Boolean);
  // A full title or creator name is an explicit lookup even when its wording
  // resembles an exclusion command. This does not turn a pure exclusion into
  // a positive keyword search for the rest of the collection.
  if (metadata.includes(analysis.literalQuery)) return { metadataRank: 3, score: 32 };
  if (!analysis.terms.length) return { metadataRank: 0, score: 0 };

  const body = [work.quote, work.description].map(normalize).filter(Boolean);
  const fields = [...keywords, ...metadata, ...body];
  if (analysis.excludedTerms.some((term) => fields.some((field) => field.includes(term))
    || keywords.some((keyword) => keyword.length > 1 && term.includes(keyword)))) {
    return { metadataRank: 0, score: 0 };
  }

  const whole = normalize(analysis.positiveQuery);
  const metadataRank = metadata.includes(whole) ? 2
    : Number(metadata.some((field) => field.length > 1 && whole.includes(field)));
  const keywordScores = new Map();
  let score = metadataRank ? 32 : 0;
  for (const term of analysis.terms) {
    const allowSubstring = term.length > 1 || whole.length === 1;
    for (const keyword of keywords) {
      const matchScore = keyword === term ? 30 : allowSubstring && keyword.includes(term) ? 18 : 0;
      keywordScores.set(keyword, Math.max(keywordScores.get(keyword) || 0, matchScore));
    }
    if (allowSubstring && metadata.some((field) => field.includes(term))) score += 16;
    if (allowSubstring && body.some((field) => field.includes(term))) score += 8;
  }

  // Existing multi-character keywords also form a small corpus vocabulary.
  // This recovers literal compounds ICU split differently, without inventing
  // character n-grams or bridging two separate keyword entries.
  for (const keyword of keywords) {
    if (keyword.length > 1 && whole.includes(keyword)) keywordScores.set(keyword, 30);
  }
  score += [...keywordScores.values()].reduce((sum, value) => sum + value, 0);
  if (!score) return { metadataRank: 0, score: 0 };

  // At most three tie-breaking points: less than one literal body match.
  score += Math.min(3, analysis.relatedTerms.filter((term) => keywords.includes(term)).length);
  return { metadataRank, score };
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function getWork(db, id) {
  return hydrateWork(db, db.prepare('SELECT * FROM works WHERE id = ?').get(id));
}

function insertExternalWork(db, item) {
  const existing = db.prepare(`
    SELECT * FROM works
    WHERE source_type = ?
      AND COALESCE(literature_title, '') = COALESCE(?, '')
      AND COALESCE(movie_title, '') = COALESCE(?, '')
    LIMIT 1
  `).get(item.sourceType, item.literatureTitle || null, item.movieTitle || null);
  if (existing) return hydrateWork(db, existing);

  const insertWork = db.prepare(`
    INSERT INTO works (
      source_type, kind, literature_title, literature_author, quote,
      movie_title, movie_year, movie_director, description, external_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insertWork.run(
    item.sourceType,
    item.kind,
    item.literatureTitle || null,
    item.literatureAuthor || null,
    item.quote || null,
    item.movieTitle || null,
    item.movieYear || null,
    item.movieDirector || null,
    item.description || '',
    item.externalUrl || null
  );

  const insertKeyword = db.prepare('INSERT INTO work_keywords (work_id, keyword) VALUES (?, ?)');
  for (const keyword of item.keywords || []) {
    if (keyword) insertKeyword.run(result.lastInsertRowid, String(keyword).slice(0, 80));
  }

  return getWork(db, result.lastInsertRowid);
}

function getComments(db, workId) {
  return db.prepare(`
    SELECT c.id, c.body, c.created_at, u.display_name, u.public_id
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.work_id = ? AND c.status = 'visible'
    ORDER BY c.id DESC
  `).all(workId).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      displayName: row.display_name,
      publicId: row.public_id
    }
  }));
}

module.exports = { searchLocalWorksDetailed, searchLocalWorks, getWork, insertExternalWork, getComments, hydrateWork, expandSearchTerms, analyzeSearchQuery };
