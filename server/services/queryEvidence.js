'use strict';

// Deliberately lexical, not a semantic parser or a visual scene verifier.
const META = ['literatureTitle', 'movieTitle', 'literatureAuthor', 'movieDirector'];
const LABELS = { literatureTitle: '书名', movieTitle: '电影名', literatureAuthor: '作者', movieDirector: '导演', quote: '待核验摘句', description: '站内描述', keyword: '人工标签' };
const EXTERNAL = new Set(['open_library', 'google_books', 'tmdb', 'omdb']);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const GRAMMAR = new Set(('的 了 着 过 地 得 在 有 是 和 与 及 也 都 但 但是 不过 而 却 只 把 被 让 对 里 上 中 我 你 他 她 它 我们 你们 他们 这 那 这个 那个 这些 那些 没有 色 一个 一些 一部 一本 一段 一下 一帧 想 我想 想要 想看 找 寻找 查找 搜索 检索 看看 可以 请 帮 帮我 有没有 关于 以及 并且 作品 内容 画面 镜头 片段 场景 电影 书籍 文字 穿 穿着 对着 描绘 同时 出现 那种 小 人 a an the and of in on with find show me').split(' '));
const WRAPPERS = ['我想找', '只想找', '请帮我找', '帮我找', '想找', '有没有', '对着', '穿着', '的那个画面'];

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function indexedText(value) {
  const raw = String(value || '');
  let normalized = '';
  const offsets = [];
  for (const { segment, index } of graphemes.segment(raw)) {
    const clean = normalize(segment);
    normalized += clean;
    // Map UTF-16 indices after normalization back to original grapheme spans.
    for (let n = 0; n < clean.length; n++) offsets.push([index, index + segment.length]);
  }
  return { raw, normalized, offsets };
}

function fieldsFor(work) {
  const fields = [...META, 'quote', 'description'].map((field) => ({ field, ...indexedText(work[field]) }));
  // Providers historically stored the user's query as a keyword. That echo is
  // not independent evidence and must never corroborate itself on later searches.
  if (!EXTERNAL.has(work.sourceType)) {
    for (const keyword of work.keywords || []) fields.push({ field: 'keyword', ...indexedText(keyword) });
  }
  return fields.filter((f) => f.normalized);
}

function findWitnesses(fields, term) {
  const needle = normalize(term);
  if (!needle) return [];
  const witnesses = [];
  for (const f of fields) {
    const index = f.normalized.indexOf(needle);
    if (index < 0) continue;
    const start = f.offsets[index][0];
    const end = f.offsets[index + needle.length - 1][1];
    witnesses.push({ field: f.field, fieldLabel: LABELS[f.field], term, start, end,
      matchedText: f.raw.slice(start, end),
      excerpt: f.raw.slice(Math.max(0, start - 24), Math.min(f.raw.length, end + 36)) });
  }
  return witnesses;
}

function vocabularyFor(works) {
  const vocabulary = new Set();
  for (const work of works) {
    for (const f of fieldsFor(work)) {
      if (META.includes(f.field) || f.field === 'keyword') vocabulary.add(f.normalized);
      else {
        for (const token of segmenter.segment(f.raw)) {
          const word = normalize(token.segment);
          if (token.isWordLike && word.length > 1 && !GRAMMAR.has(word)) vocabulary.add(word);
        }
      }
    }
  }
  return [...vocabulary].filter(Boolean).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function buildQueryPlan(query, analysis, works) {
  const literal = normalize(query);
  const exactMetadata = literal && works.some((w) => META.some((f) => normalize(w[f]) === literal));
  const base = { version: 2, rawQuery: String(query || ''), logic: 'all', intent: 'search',
    requiredTerms: [], unresolvedTerms: [], excludedTerms: analysis.excludedTerms,
    scope: 'record_text', sameSceneVerified: false,
    note: '命中只说明当前记录文字支持这些条件，不证明原文真实、镜头共现或画面中不存在排除项。' };
  if (!literal) return { ...base, intent: 'empty' };
  // Complete names are always valid lookups, even if their wording resembles a command.
  if (exactMetadata) return { ...base, intent: 'known_item', requiredTerms: [literal], excludedTerms: [] };
  if (!analysis.terms.length) return { ...base, intent: 'no_positive_terms' };

  const text = analysis.positiveQuery.normalize('NFKC').toLowerCase();
  // A narrow *intent* rule, not a blacklist of devices or colours. Ambiguous
  // descriptive queries remain visible as partial results, never as verified hits.
  if (/(?:怎么|如何|怎样|how\s+to).{0,24}(?:校准|连接|配对|训练|安装|维修|修复|配置|编程|下载|制作|做菜|烹饪)|(?:做法|操作教程|安装步骤)/iu.test(text)) {
    return { ...base, intent: 'outside_scope', reason: '当前入口检索文学与电影意象，不回答操作教程；颜色词不足以支持这类查询。' };
  }

  const vocabulary = vocabularyFor(works);
  let stripped = text;
  for (const wrapper of WRAPPERS) stripped = stripped.split(wrapper).join(' ');
  const required = new Set();
  const unresolved = new Set();
  // Work per punctuation-separated chunk; never manufacture a term by joining
  // two separate query tokens or two separate keyword entries.
  for (const chunk of stripped.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)) {
    const normalized = normalize(chunk);
    const covered = new Uint8Array(normalized.length);
    const wordBoundaries = [...segmenter.segment(chunk)].filter((t) => t.isWordLike).map((t) => normalize(t.segment));
    for (let position = 0; position < normalized.length; position++) {
      const word = vocabulary.find((v) => normalized.startsWith(v, position)
        && (v.length > 1 || normalized === v || wordBoundaries.includes(v)
          || GRAMMAR.has(normalized[position - 1]) || GRAMMAR.has(normalized[position + v.length])));
      if (!word || GRAMMAR.has(word)) continue;
      required.add(word);
      covered.fill(1, position, position + word.length);
      position += word.length - 1;
    }
    let gap = '';
    const flush = () => {
      for (const token of segmenter.segment(gap)) {
        const value = normalize(token.segment);
        if (token.isWordLike && value && !GRAMMAR.has(value)
          && ![...value].every((char) => GRAMMAR.has(char))) unresolved.add(value);
      }
      gap = '';
    };
    for (let i = 0; i < normalized.length; i++) {
      if (covered[i]) flush(); else gap += normalized[i];
    }
    flush();
  }
  // Preserve descriptive negation as an exact phrase rather than silently
  // discarding its polarity and claiming a positive-only match is complete.
  const polarityPhrases = text.replaceAll('有没有', '是否有').match(/(?:没有|没能|未曾|并未)[^,，。;；\s]{1,18}/gu) || [];
  for (const phrase of polarityPhrases) required.add(normalize(phrase));
  for (const term of required) unresolved.delete(term);
  const unsupportedLogic = /或者|\b(?:or|either)\b|[或且]|并非|不是/iu.test(text);
  return { ...base, requiredTerms: [...required], unresolvedTerms: [...unresolved],
    logic: unsupportedLogic ? 'needs_review' : 'all',
    ...(unsupportedLogic ? { reason: '这个查询包含尚未可靠解析的逻辑，以下仅列候选。' } : {}) };
}

function explainWork(work, plan) {
  const fields = fieldsFor(work);
  if (plan.intent === 'known_item') {
    const evidence = findWitnesses(fields.filter((f) => META.includes(f.field) && f.normalized === plan.requiredTerms[0]), plan.requiredTerms[0]);
    return evidence.length ? { type: 'exact_metadata', matchedTerms: plan.requiredTerms,
      missingTerms: [], unresolvedTerms: [], witnesses: evidence, scope: 'record_text', sameSceneVerified: false } : null;
  }
  if (plan.intent !== 'search') return null;
  // Exclusions apply to both primary and partial groups. Absence in indexed
  // text is explicitly NOT evidence of absence from the underlying film.
  if (plan.excludedTerms.some((term) => findWitnesses(fields, term).length
    || fields.some((f) => f.field === 'keyword' && f.normalized.length > 1 && normalize(term).includes(f.normalized)))) return null;
  const matchedTerms = [], missingTerms = [], witnesses = [];
  for (const term of plan.requiredTerms) {
    const evidence = findWitnesses(fields, term);
    if (evidence.length) { matchedTerms.push(term); witnesses.push(...evidence); }
    else missingTerms.push(term);
  }
  if (!matchedTerms.length) return null;
  const complete = !missingTerms.length && !plan.unresolvedTerms.length && plan.logic === 'all';
  return { type: complete ? 'all_text_conditions' : 'partial', matchedTerms, missingTerms,
    unresolvedTerms: plan.unresolvedTerms, witnesses, scope: 'record_text', sameSceneVerified: false };
}

function shouldSearchExternal(plan) {
  return plan.intent === 'search' && plan.logic === 'all' && !plan.excludedTerms.length
    && plan.requiredTerms.length + plan.unresolvedTerms.length === 1;
}

module.exports = { normalize, indexedText, fieldsFor, findWitnesses, buildQueryPlan, explainWork, shouldSearchExternal };
