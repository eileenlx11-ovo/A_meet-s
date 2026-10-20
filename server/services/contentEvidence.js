'use strict';
const crypto = require('node:crypto');
const catalogue = require('../../data/evidence-catalogue.json');

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
function workKey(work) {
  return JSON.stringify([work.sourceType, work.literatureTitle || '', work.literatureAuthor || '',
    work.movieTitle || '', work.movieYear || null, work.movieDirector || '']);
}
function fingerprint(work) {
  return hash(JSON.stringify({ quote: work.quote || '', description: work.description || '',
    keywords: [...new Set(work.keywords || [])].sort() }));
}
function isHttps(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
function validateSegment(segment, media) {
  const errors = [];
  if (!isHttps(media.sourceUrl)) errors.push('需要可追溯的 HTTPS 媒体来源');
  if (!/^[a-f0-9]{64}$/.test(media.mediaSha256 || '')) errors.push('需要具体媒体版本的 SHA-256');
  if (media.rightsStatus !== 'reviewed') errors.push('媒体使用权限未核验');
  const start = segment.startSeconds, end = segment.endSeconds, duration = media.durationSeconds;
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end <= start || end > duration) errors.push('起止时间或媒体时长无效');
  if (!Number.isFinite(segment.referenceFrameSeconds) || segment.referenceFrameSeconds < start || segment.referenceFrameSeconds >= end) errors.push('代表帧必须位于镜头区间内');
  if (!segment.annotation || !Array.isArray(segment.tags) || !segment.tags.length || !segment.tags.every((x) => typeof x === 'string' && x.trim())) errors.push('缺少镜头描述或标签');
  if (segment.status !== 'reviewed' || !segment.reviewedBy || !/^\d{4}-\d{2}-\d{2}$/.test(segment.reviewedAt || '')) errors.push('缺少人工观看复核记录');
  return errors;
}
function validateCatalogue(data) {
  if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error('Invalid evidence catalogue schema');
  const keys = new Set();
  for (const entry of data.entries) {
    if (!entry.workKey || keys.has(entry.workKey)) throw new Error('Duplicate or missing evidence identity');
    keys.add(entry.workKey);
    if (!/^[a-f0-9]{64}$/.test(entry.snapshotSha256 || '')) throw new Error('Missing content fingerprint');
    for (const p of entry.locatedPassages || []) {
      if (!p.source?.edition || !p.source?.locator || !p.source?.language || !isHttps(p.source.url)
        || !p.sourceExcerpt || hash(p.sourceExcerpt) !== p.excerptSha256 || !p.checkedAt) throw new Error('Invalid located passage');
    }
    for (const source of entry.relationship?.sources || []) {
      if (!isHttps(source.url) || !source.title || !source.checkedAt) throw new Error('Invalid relationship source');
    }
  }
  return true;
}
validateCatalogue(catalogue);
const entries = new Map(catalogue.entries.map((entry) => [entry.workKey, entry]));

function contentEvidenceFor(work) {
  const entry = entries.get(workKey(work));
  const current = entry && entry.snapshotSha256 === fingerprint(work);
  const status = current ? 'current' : entry ? 'stale' : 'not_catalogued';
  return {
    catalogueStatus: status,
    quote: { status: 'unverified', label: '站内摘句 · 原文与中文版本待核验',
      note: status === 'stale' ? '记录内容已变更，既有核查信息暂停使用。' : '没有中文译本、页码或段落核查记录；请勿作为作者原话引用。' },
    relationship: current ? entry.relationship : { type: 'unverified_pair', status: 'unverified', label: '配对关系待核验', sources: [] },
    locatedPassages: current ? entry.locatedPassages || [] : [],
    videos: (work.videos || []).map((v) => ({ provider: v.provider, providerVideoId: v.providerVideoId,
      status: 'unverified', label: '仅有视频链接，未核验具体镜头', segments: [] })),
    // This stage adds a validation gate and an annotation queue, not visual retrieval.
    sameSceneVerified: false
  };
}
function attachContentEvidence(work) {
  return work ? { ...work, contentEvidence: contentEvidenceFor(work) } : work;
}
module.exports = { workKey, fingerprint, isHttps, validateSegment, validateCatalogue, contentEvidenceFor, attachContentEvidence };
