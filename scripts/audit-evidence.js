#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateCatalogue, validateSegment, contentEvidenceFor } = require('../server/services/contentEvidence');
const catalogue = require('../data/evidence-catalogue.json');
const queue = require('../data/video-annotation-queue.json');
const works = require('../data/seed-works.json');
validateCatalogue(catalogue);
const entries = works.map((w) => ({ title: w.literatureTitle, ...contentEvidenceFor(w) }));
const videos = queue.items.map((media) => ({ providerVideoId: media.providerVideoId,
  status: media.status, reviewedSegments: (media.segments || []).filter((s) => !validateSegment(s, media).length).length,
  blockingReason: media.blockingReason }));
const report = { schemaVersion: 1, auditedAt: new Date().toISOString(),
  note: 'Structural audit, not an automatic fact checker or a copyright authorization. No local user database is opened.',
  counts: { seedRecords: works.length, currentSnapshots: entries.filter((e) => e.catalogueStatus === 'current').length,
    unverifiedChineseQuotes: entries.filter((e) => e.quote.status === 'unverified').length,
    locatedReferencePassages: entries.reduce((n, e) => n + e.locatedPassages.length, 0),
    sourceVerifiedAdaptationPairs: entries.filter((e) => e.relationship.status === 'source_verified').length,
    editorialThemePairs: entries.filter((e) => e.relationship.type === 'editorial_theme').length,
    unverifiedPairs: entries.filter((e) => e.relationship.status === 'unverified').length,
    pendingVideos: videos.filter((v) => !v.reviewedSegments).length,
    structurallyReviewedSegments: videos.reduce((n, v) => n + v.reviewedSegments, 0) },
  entries, videos };
report.readyForVerifiedQuotationUse = report.counts.unverifiedChineseQuotes === 0;
report.readyForVisualEvaluation = videos.length > 0 && videos.every((v) => v.reviewedSegments > 0);
const args = process.argv.slice(2); const oi = args.indexOf('--output');
if (oi >= 0) { const file = args[oi + 1]; if (!file) throw new Error('--output requires a filename'); fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ counts: report.counts, readyForVerifiedQuotationUse: report.readyForVerifiedQuotationUse, readyForVisualEvaluation: report.readyForVisualEvaluation }, null, 2));
if (args.includes('--strict') && (!report.readyForVerifiedQuotationUse || !report.readyForVisualEvaluation)) process.exitCode = 1;
