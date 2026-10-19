#!/usr/bin/env node
'use strict';

// Real browser checks against an isolated app, never the user's running server.
// Install its browser once: npx playwright install chromium --only-shell
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');

process.env.DB_PATH = ':memory:';
process.env.DISABLE_EXTERNAL_SEARCH = '1';
process.env.IMAGE_PROVIDER = 'none';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server/app');
const { closeDb } = require('../server/db');

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) {
    throw new Error('Usage: node scripts/smoke-browser.js [--output file.json]');
  }
  const results = [];
  const pageErrors = [];
  const outputPath = args[0] === '--output' ? path.resolve(args[1]) : null;
  function writeReport(report) {
    if (!outputPath) return;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  writeReport({ capturedAt: new Date().toISOString(), status: 'running' });
  const server = createApp().listen(0, '127.0.0.1');
  let browser;
  try {
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    // External images, fonts, and embedded services are not part of this test.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return new URL(url).origin === origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let registerRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url() === `${origin}/api/auth/register`) registerRequests += 1;
    });

    async function check(name, action) {
      await action();
      results.push({ name, status: 'passed' });
      console.log(`PASS ${name}`);
    }
    async function login() {
      await page.fill('#auth-email', 'browser@example.test');
      await page.fill('#auth-password', 'synthetic-password-123');
      await Promise.all([
        page.waitForURL(`${origin}/search.html`),
        page.click('#auth-submit')
      ]);
    }

    const registered = await context.request.post(`${origin}/api/auth/register`, {
      data: { displayName: '浏览器验收读者', email: 'browser@example.test', password: 'synthetic-password-123' }
    });
    assert.equal(registered.status(), 201);
    const user = (await registered.json()).user;
    await context.request.post(`${origin}/api/auth/logout`);

    await check('login with an empty, disabled name reaches the search page', async () => {
      await page.goto(`${origin}/login.html`);
      assert.equal(await page.locator('#auth-name').isVisible(), false);
      assert.equal(await page.locator('#auth-name').isDisabled(), true);
      assert.equal(await page.locator('#auth-name').evaluate((input) => input.required), false);
      await login();
    });

    await check('profile identity and saved biography render correctly', async () => {
      await page.goto(`${origin}/profile.html`);
      await page.waitForFunction(() => document.getElementById('profileIdentity').textContent.includes('浏览器验收读者'));
      assert.equal(await page.locator('#profileIdentity').textContent(), `${user.displayName} · ${user.publicId}`);
      await page.fill('#profileBio', '验收用简介：喜欢雨夜和电影。');
      await Promise.all([
        page.waitForResponse((response) => response.url() === `${origin}/api/profile/me` && response.request().method() === 'PUT' && response.status() === 200),
        page.locator('#profileForm button[type="submit"]').click()
      ]);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('profileBio').value === '验收用简介：喜欢雨夜和电影。');
      assert.equal(await page.locator('#profileIdentity').textContent(), `${user.displayName} · ${user.publicId}`);
    });

    await check('rainy-night search opens a work and saves a comment', async () => {
      await page.goto(`${origin}/search.html`);
      await page.fill('#searchInput', '雨夜');
      await page.click('#searchButton');
      await page.locator('.result-item').first().waitFor();
      assert.match(await page.locator('.result-item').first().textContent(), /花样年华/);
      await page.locator('.result-item').first().getByRole('link', { name: '进入批注页' }).click();
      await page.waitForFunction(() => document.getElementById('workTitle')?.textContent === '花样年华');
      await page.fill('#commentBody', '验收用的合成批注。');
      await page.locator('#commentForm button[type="submit"]').click();
      await page.waitForFunction(() => document.getElementById('commentsList').textContent.includes('验收用的合成批注。'));
    });

    await check('unconfigured image generation is clearly disabled', async () => {
      await page.waitForFunction(() => document.querySelector('[data-image-type="bookmark"]').disabled);
      assert.match(await page.locator('#imageProviderNotice').textContent(), /未启用/);
      assert.equal(await page.locator('[data-image-type="ticket"]').isDisabled(), true);
      assert.equal(await page.locator('[data-image-type="poster"]').isDisabled(), true);
    });

    await check('a query without corpus evidence shows an empty result state', async () => {
      await page.goto(`${origin}/search.html`);
      await page.fill('#searchInput', '量子计算机超导芯片');
      await page.click('#searchButton');
      await page.waitForFunction(() => document.getElementById('resultsContainer').textContent.includes('暂无此意象'));
      assert.equal(await page.locator('.result-item').count(), 0);
    });

    await check('registration requires a name through native browser validation', async () => {
      await context.request.post(`${origin}/api/auth/logout`);
      await page.goto(`${origin}/login.html`);
      await page.click('#toggle-auth');
      await page.fill('#auth-email', 'new-reader@example.test');
      await page.fill('#auth-password', 'synthetic-password-123');
      assert.equal(await page.locator('#auth-name').isVisible(), true);
      await page.evaluate(() => {
        window.__nameValidationEvents = 0;
        document.getElementById('auth-name').addEventListener('invalid', () => { window.__nameValidationEvents += 1; });
      });
      await page.click('#auth-submit');
      assert.ok(await page.evaluate(() => window.__nameValidationEvents > 0));
      assert.equal(registerRequests, 0);
      await page.fill('#auth-name', '新增验收读者');
      await Promise.all([page.waitForURL(`${origin}/search.html`), page.click('#auth-submit')]);
      assert.equal(registerRequests, 1);
    });

    await check('returning from registration to login accepts an empty name', async () => {
      await context.request.post(`${origin}/api/auth/logout`);
      await page.goto(`${origin}/login.html`);
      await page.click('#toggle-auth');
      await page.fill('#auth-name', '临时称呼');
      await page.fill('#auth-name', '');
      await page.click('#toggle-auth');
      assert.equal(await page.locator('#auth-name').isDisabled(), true);
      await login();
    });

    assert.deepEqual(pageErrors, [], 'No uncaught page errors should occur');
    const report = {
      capturedAt: new Date().toISOString(),
      status: 'passed',
      node: process.version,
      browser: browser.version(),
      scope: 'Local app, in-memory synthetic database, external search and image generation disabled, external browser requests blocked.',
      results,
      pageErrors
    };
    writeReport(report);
    console.log(`Browser smoke: ${results.length}/${results.length} passed (Chromium ${report.browser}).`);
  } catch (error) {
    writeReport({ capturedAt: new Date().toISOString(), status: 'failed', results, pageErrors, error: error.message });
    throw error;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
