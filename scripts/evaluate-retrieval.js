#!/usr/bin/env node
'use strict';

// Offline diagnostic only: imports the local repository, seeds an in-memory
// SQLite database, and never calls external book, movie, or generation APIs.
// Run with Node 24+: node scripts/evaluate-retrieval.js --output /tmp/report.json
// --strict is opt-in because exploratory cases include unimplemented semantics.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultFixturePath = path.join(repoRoot, 'test/fixtures/retrieval-cases.json');

function parseArgs(argv) {
  const options = { json: false, strict: false, output: null, fixtures: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--output' || arg === '--fixtures') {
      const destination = argv[++index];
      if (!destination || destination.startsWith('--')) {
        throw new Error(`${arg} requires a file path`);
      }
      options[arg === '--output' ? 'output' : 'fixtures'] = path.resolve(destination);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function workTitle(work) {
  return work.literatureTitle || work.movieTitle;
}

function validateFixture(fixture, seedWorks) {
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases)) {
    throw new Error('Unsupported retrieval fixture format');
  }
  const corpusTitles = new Set(seedWorks.map(workTitle));
  const seenIds = new Set();
  const checks = new Set([
    'top1', 'topk_all', 'topk_any', 'empty',
    'topk_any_without_forbidden', 'review_only'
  ]);
  for (const testCase of fixture.cases) {
    if (!testCase.id || seenIds.has(testCase.id)) {
      throw new Error(`Missing or duplicate case id: ${testCase.id}`);
    }
    seenIds.add(testCase.id);
    if (!checks.has(testCase.check) || typeof testCase.query !== 'string') {
      throw new Error(`Invalid check or query for ${testCase.id}`);
    }
    for (const title of [...testCase.expectedTitles, ...(testCase.forbiddenTitles || [])]) {
      if (!corpusTitles.has(title)) {
        throw new Error(`Case ${testCase.id} references an absent seed work: ${title}`);
      }
    }
  }
}

function evaluateCase(testCase, results, expandedTerms) {
  const titles = results.map(workTitle);
  const k = testCase.check === 'top1' ? 1 : (testCase.k || 3);
  const topTitles = titles.slice(0, k);
  const expectedRanks = Object.fromEntries(testCase.expectedTitles.map((title) => [
    title, titles.includes(title) ? titles.indexOf(title) + 1 : null
  ]));
  const missingFromTopK = testCase.expectedTitles.filter((title) => !topTitles.includes(title));
  const matchedInTopK = testCase.expectedTitles.filter((title) => topTitles.includes(title));
  // Exclusions apply to the complete displayed result set, not just the top k.
  const returnedForbiddenTitles = (testCase.forbiddenTitles || []).filter((title) => titles.includes(title));
  let passed;
  switch (testCase.check) {
    case 'top1':
    case 'topk_any':
      passed = matchedInTopK.length > 0;
      break;
    case 'topk_all':
      passed = missingFromTopK.length === 0;
      break;
    case 'empty':
      passed = results.length === 0;
      break;
    case 'topk_any_without_forbidden':
      passed = matchedInTopK.length > 0 && returnedForbiddenTitles.length === 0;
      break;
    case 'review_only':
      passed = null;
      break;
    default:
      throw new Error(`Unsupported check: ${testCase.check}`);
  }
  return {
    ...testCase,
    verdict: passed === null ? 'review' : passed ? 'pass' : 'fail',
    resultCount: results.length,
    expectedRanks,
    matchedInTopK,
    missingFromTopK,
    returnedForbiddenTitles,
    expandedTerms,
    results: results.map((work, index) => ({
      rank: index + 1,
      id: work.id,
      literatureTitle: work.literatureTitle,
      literatureAuthor: work.literatureAuthor,
      movieTitle: work.movieTitle,
      movieDirector: work.movieDirector,
      description: work.description,
      quote: work.quote,
      keywords: work.keywords,
      videoCount: work.videos.length
    }))
  };
}

function summarize(cases) {
  const summary = { cases: cases.length, passed: 0, failed: 0, reviewOnly: 0, byCategory: {} };
  for (const item of cases) {
    const category = summary.byCategory[item.category] ||= {
      cases: 0, passed: 0, failed: 0, reviewOnly: 0
    };
    category.cases += 1;
    const key = item.verdict === 'pass' ? 'passed' : item.verdict === 'fail' ? 'failed' : 'reviewOnly';
    summary[key] += 1;
    category[key] += 1;
  }
  return summary;
}

function printSummary(report) {
  console.log('A_meet-s offline retrieval diagnostic (hand-authored examples, not a benchmark)');
  console.log(`Corpus: ${report.corpus.recordCount} records; Node ${report.runtime.node}`);
  console.log(`Source SHA-256: ${report.source.worksRepositorySha256}`);
  for (const [name, stats] of Object.entries(report.summary.byCategory)) {
    console.log(`${name}: ${stats.passed}/${stats.cases - stats.reviewOnly} checks passed; ${stats.reviewOnly} review-only`);
  }
  for (const testCase of report.cases) {
    const top = testCase.results.slice(0, 3).map((work) => `${work.rank}. ${workTitle(work)}`).join(' | ') || '(empty)';
    console.log(`[${testCase.verdict.toUpperCase()}] ${testCase.id}: ${testCase.query}`);
    console.log(`  ${testCase.resultCount} results; ${top}`);
    if (testCase.verdict === 'fail') {
      console.log(`  expected ranks: ${JSON.stringify(testCase.expectedRanks)}; excluded returned: ${JSON.stringify(testCase.returnedForbiddenTitles)}`);
    }
  }
  console.log(`Diagnostic outcomes: ${report.summary.passed} pass, ${report.summary.failed} fail, ${report.summary.reviewOnly} review-only.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/evaluate-retrieval.js [--fixtures cases.json] [--output file.json] [--json] [--strict]');
    return;
  }
  const fixtureBytes = fs.readFileSync(options.fixtures);
  const fixture = JSON.parse(fixtureBytes);
  const seedPath = path.resolve(repoRoot, fixture.corpus.path);
  const seedBytes = fs.readFileSync(seedPath);
  const seedWorks = JSON.parse(seedBytes);
  const seedHash = sha256(seedBytes);
  if (seedHash !== fixture.corpus.sha256 || seedWorks.length !== fixture.corpus.recordCount) {
    throw new Error('Seed corpus changed. Review relevance labels and deliberately update the fixture fingerprint before comparing results.');
  }
  validateFixture(fixture, seedWorks);

  // Set this before requiring db.js. Existing user databases are never opened.
  process.env.DB_PATH = ':memory:';
  const { getDb, closeDb } = require('../server/db');
  const { searchLocalWorks, expandSearchTerms } = require('../server/services/worksRepository');
  let cases;
  try {
    const db = getDb();
    cases = fixture.cases.map((testCase) => evaluateCase(
      testCase,
      searchLocalWorks(db, testCase.query),
      expandSearchTerms(testCase.query)
    ));
  } finally {
    closeDb();
  }

  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    purpose: fixture.purpose,
    annotationMethod: fixture.annotationMethod,
    limitations: [
      `${fixture.cases.length} deliberately chosen diagnostic queries over ${seedWorks.length} hand-curated records; no random sampling, independent annotators, or real-user study.`,
      'Exact metadata checks, subjective imagery checks, and negation/multi-condition capability probes are reported separately.',
      'Local repository only. No HTTP, browser, external-provider availability, relevance of new external data, or paid API calls are evaluated.',
      'A work-level hit cannot verify an actual film frame, audiovisual content, a clip timestamp, quotation provenance, or an adaptation relationship.',
      'Exclusion checks use textual seed evidence. Unknown visual content cannot establish the absence of a feature.',
      'No overall accuracy, semantic quality, latency benchmark, or cross-modal model comparison is claimed.'
    ],
    runtime: { node: process.version, sqliteDatabase: ':memory:' },
    source: {
      gitHead: gitHead(),
      worksRepositorySha256: sha256(fs.readFileSync(path.join(repoRoot, 'server/services/worksRepository.js'))),
      fixturePath: path.relative(repoRoot, options.fixtures),
      fixtureSha256: sha256(fixtureBytes)
    },
    corpus: {
      ...fixture.corpus,
      recordsWithVideoLinks: seedWorks.filter((work) => work.videos?.length > 0).length,
      videoLinks: seedWorks.reduce((count, work) => count + (work.videos?.length || 0), 0)
    },
    summary: summarize(cases),
    cases
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, json, 'utf8');
  }
  if (options.json) process.stdout.write(json);
  else printSummary(report);
  if (options.strict && report.summary.failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Retrieval diagnostic failed: ${error.message}`);
  process.exitCode = 1;
}
