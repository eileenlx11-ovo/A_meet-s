#!/usr/bin/env node
'use strict';
// Component tests only: real Chromium DOM + production JS + explicit in-process
// service adapter. NO HTTP, no navigation, no full Express/auth or visual layout
// acceptance. This deliberately does not substitute for blocked HTTP smoke tests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
process.env.DB_PATH = ':memory:';
const { getDb, closeDb } = require('../server/db');
const { buildSearchResponse } = require('../server/services/searchService');
const { getWork } = require('../server/services/worksRepository');
const root = path.resolve(__dirname, '..');
const db = getDb();
const cases = [], pageErrors = [];
let browser;
async function createFixture() {
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', error => pageErrors.push(error.message));
  // There is no network dependency. Do not work around browser access policies.
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(root, 'search.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  await page.setContent(html);
  await page.exposeFunction('__testSearchService', query => buildSearchResponse(db, query));
  for (const file of ['js/api-client.js', 'js/evidence-ui.js', 'js/search.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  }
  // Only transport is replaced. The service, DB, query constraints and DOM
  // rendering are production code; external providers remain disabled.
  await page.evaluate(() => {
    AnchorApi.request = async url => {
      const parsed = new URL(url, 'https://fixture.invalid');
      if (parsed.pathname !== '/api/search') throw Error('Unexpected fixture read');
      return window.__testSearchService(parsed.searchParams.get('q') || '');
    };
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  return page;
}
async function main() {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox'] });
  async function check(name, fn) {
    const page = await createFixture();
    try { await fn(page); cases.push({ name, passed: true }); }
    catch (error) { cases.push({ name, passed: false, error: error.message }); }
    finally { console.log(JSON.stringify(cases[cases.length - 1])); await page.close(); }
  }
  async function search(page, q) {
    await page.locator('#searchInput').fill(q);
    await page.locator('#searchButton').click();
    await page.locator('.evidence-plan').waitFor();
  }
  try {
    await check('field witnesses render for the rainy-night primary hit', async page => {
      await search(page, '雨夜');
      assert.equal(await page.locator('[data-result-group="primary"] .result-item').count(), 1);
      await page.locator('.evidence-match summary').first().click();
      assert((await page.locator('.evidence-witnesses').first().innerText()).includes('人工标签 / 雨夜'));
    });
    await check('snow/dress is partial only, with explicit missing constraints', async page => {
      await search(page, '雪地里穿祖母绿裙子');
      assert.equal(await page.locator('[data-result-group="primary"]').count(), 0);
      assert.equal(await page.locator('[data-result-group="partial"] .result-item').count(), 2);
      for (const summary of await page.locator('.evidence-match summary').all()) await summary.click();
      const text = await page.locator('#resultsContainer').innerText();
      assert(text.includes('缺少文字依据：雪地')); assert(text.includes('祖母绿；裙子'));
    });
    await check('operation-intent queries show the scope explanation without colour hits', async page => {
      await search(page, '粉色无线耳机怎么连接电脑');
      assert.equal(await page.locator('.result-item').count(), 0);
      assert((await page.locator('.evidence-plan').innerText()).includes('不回答操作教程'));
    });
    await check('located English passage and unverified Chinese quote remain distinct', async page => {
      const work = getWork(db, 5);
      await page.evaluate(w => document.body.append(AnchorEvidence.renderSources(w)), work);
      const text = await page.locator('.evidence-sources').innerText();
      assert(text.includes('Chapter LVIII'));
      assert(text.includes('原文与中文版本待核验'));
      assert(text.includes('编辑概述，非出版译文'));
      assert((await page.locator('.evidence-passage a').getAttribute('href')).startsWith('https://www.gutenberg.org/'));
    });
    await check('Hours pairing is editorial, not a direct adaptation claim', async page => {
      await page.evaluate(w => document.body.append(AnchorEvidence.renderSources(w)), getWork(db, 15));
      assert((await page.locator('.evidence-sources').innerText()).includes('不是《到灯塔去》的直接改编'));
    });
    await check('untrusted witness text cannot create elements or JavaScript links', async page => {
      const result = await page.evaluate(() => {
        const match = { type: 'partial', matchedTerms: ['<img src=x onerror="window.injected=1">'], missingTerms: [], unresolvedTerms: [],
          witnesses: [{ fieldLabel: '<script>x</script>', term: 'a', start: 0, end: 1, excerpt: '<img src=x onerror="window.injected=1">' }] };
        const element = AnchorEvidence.renderMatch(match); document.body.append(element);
        return { images: element.querySelectorAll('img').length, injected: window.injected || 0,
          url: AnchorEvidence.safeUrl('javascript:alert(1)') };
      });
      assert.deepEqual(result, { images: 0, injected: 0, url: null });
    });
    await check('a late older response cannot overwrite the latest search result', async page => {
      await page.evaluate(async () => {
        const realRequest = AnchorApi.request;
        AnchorApi.request = async url => {
          const result = await realRequest(url);
          if (new URL(url, 'https://fixture.invalid').searchParams.get('q') === '雨夜') await new Promise(r => setTimeout(r, 150));
          return result;
        };
        document.getElementById('searchInput').value = '雨夜'; const old = executeSearch();
        document.getElementById('searchInput').value = '情书'; const latest = executeSearch();
        await Promise.all([old, latest]);
      });
      assert((await page.locator('.evidence-plan').innerText()).includes('情书'));
      assert(!(await page.locator('[data-result-group="primary"]').innerText()).includes('花样年华'));
    });
    await check('empty query also invalidates an earlier pending result', async page => {
      await page.evaluate(async () => {
        const realRequest = AnchorApi.request;
        AnchorApi.request = async url => { const value = await realRequest(url); await new Promise(r => setTimeout(r, 100)); return value; };
        document.getElementById('searchInput').value = '雨夜'; const old = executeSearch();
        document.getElementById('searchInput').value = ''; await executeSearch(); await old;
      });
      assert.equal(await page.locator('.result-item').count(), 0);
      assert((await page.locator('#resultsContainer').innerText()).includes('请在打字机前'));
    });
    const report = { schemaVersion: 1, testedAt: new Date().toISOString(),
      scope: 'In-memory Chromium DOM component tests, explicit in-process transport adapter, production query/service code, real synthetic SQLite. NO HTTP; not full Express/auth or visual layout acceptance.',
      runtime: { node: process.version, playwright: require('playwright/package.json').version, chromium: browser.version() },
      implementationHashes: Object.fromEntries(['js/search.js', 'js/evidence-ui.js', 'server/services/queryEvidence.js', 'server/services/searchService.js', 'server/services/contentEvidence.js', 'data/evidence-catalogue.json'].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')])),
      cases, pageErrors, passed: cases.every(c => c.passed) && !pageErrors.length };
    const output = path.join(root, 'docs/stage2/dom-components.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally { await browser.close(); closeDb(); }
}
main().catch(async error => { console.error(error); if (browser) await browser.close().catch(() => {}); closeDb(); process.exitCode = 1; });
