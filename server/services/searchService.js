'use strict';
const { searchLocalWorksDetailed, insertExternalWork } = require('./worksRepository');
const { shouldSearchExternal, normalize } = require('./queryEvidence');

async function buildSearchResponse(db, query, options = {}) {
  if (typeof query !== 'string' || query.length > 200) {
    const error = new Error('查询必须是 200 字以内的文字。'); error.status = 400; throw error;
  }
  query = query.trim();
  const local = searchLocalWorksDetailed(db, query);
  const externalStatus = { books: 'skipped', movies: 'skipped' };
  const externalResults = [];
  if (options.externalEnabled && local.results.length < 8 && shouldSearchExternal(local.queryPlan)) {
    const providers = [['books', options.searchBooks], ['movies', options.searchMovies]];
    const responses = await Promise.allSettled(providers.map(([, provider]) => Promise.resolve().then(() => provider ? provider(query) : [])));
    const seen = new Set([...local.results, ...local.partialResults].map((w) => w.id));
    for (let index = 0; index < responses.length; index++) {
      const response = responses[index];
      const items = response.status === 'fulfilled' && Array.isArray(response.value) ? response.value : [];
      externalStatus[providers[index][0]] = items.length ? 'ok' : 'unavailable';
      // searchBooks aggregates multiple sources. Apply the shared result limit
      // after validation and deduplication so later book sources stay eligible.
      for (const item of items) {
        if (externalResults.length >= 10) break;
        if (!item || typeof item.sourceType !== 'string' || !['book', 'movie'].includes(item.kind)
          || !(typeof item.literatureTitle === 'string' || typeof item.movieTitle === 'string')) continue;
        // Do not persist the search query as evidence for the result it retrieved.
        const cleanItem = { ...item, keywords: (Array.isArray(item.keywords) ? item.keywords : []).filter((k) => normalize(k) !== normalize(query)) };
        const work = insertExternalWork(db, cleanItem);
        if (seen.has(work.id)) continue;
        seen.add(work.id);
        externalResults.push({ ...work, match: { type: 'external_metadata', scope: 'provider_metadata',
          sameSceneVerified: false, matchedTerms: [], missingTerms: [], unresolvedTerms: [], witnesses: [] } });
      }
    }
  }
  // External metadata is intentionally never merged into confirmed text hits.
  return { ...local, externalResults, externalStatus };
}
module.exports = { buildSearchResponse };
