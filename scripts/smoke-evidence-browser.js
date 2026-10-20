#!/usr/bin/env node
'use strict';
// This is a UI/service contract harness, not the full Express/auth application.
// It uses the real discovery service, real SQLite seed DB, and the changed UI.
// Auth and the unrelated main stylesheet are intentionally empty test fixtures.
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.env.DB_PATH = ':memory:';
const { getDb, closeDb } = require('../server/db');
const { getWork } = require('../server/services/worksRepository');
const { buildSearchResponse } = require('../server/services/searchService');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['/search.html','/js/search.js','/js/api-client.js','/js/evidence-ui.js','/css/evidence.css']);
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};
const db = getDb();
const errors = [], cases = [];
const server = http.createServer(async (req,res) => {
 try {
  const url = new URL(req.url,'http://127.0.0.1');
  let data;
  if(url.pathname==='/api/search') data=await buildSearchResponse(db,url.searchParams.get('q')||'');
  else if(/^\/api\/works\/\d+$/.test(url.pathname)) data={work:getWork(db,Number(url.pathname.split('/').pop()))};
  if(data){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;}
  if(url.pathname==='/source-fixture.html'){
   res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="workEvidence"></div><script src="/js/api-client.js"></script><script src="/js/evidence-ui.js"></script></html>');return;
  }
  if(['/js/auth.js','/css/style.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':mime[path.extname(url.pathname)]});res.end('/* intentionally excluded from this UI/service harness */');return;}
  if(!allowed.has(url.pathname)){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(url.pathname)]});res.end(fs.readFileSync(path.join(root,url.pathname)));
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 const check=async(name,fn)=>{try{await fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}};
 const search=async(q)=>{await page.goto(base+'/search.html');await page.locator('#searchInput').fill(q);await page.locator('#searchButton').click();await page.locator('.evidence-plan').waitFor();};
 try{
  await check('rainy-night primary result has field-level witnesses',async()=>{
   await search('雨夜');assert.equal(await page.locator('[data-result-group="primary"] .result-item').count(),1);
   await page.locator('.evidence-match summary').first().click();assert((await page.locator('.evidence-witnesses').first().innerText()).includes('人工标签 / 雨夜'));
  });
  await check('snow/dress has two labelled partial suggestions and no complete result',async()=>{
   await search('雪地里穿祖母绿裙子');assert.equal(await page.locator('[data-result-group="primary"]').count(),0);
   assert.equal(await page.locator('[data-result-group="partial"] .result-item').count(),2);
   for(const summary of await page.locator('.evidence-match summary').all())await summary.click();
   const text=await page.locator('#resultsContainer').innerText();assert(text.includes('缺少文字依据：雪地'));assert(text.includes('祖母绿；裙子'));
  });
  await check('procedure query displays scope explanation, not colour recommendations',async()=>{
   await search('粉色无线耳机怎么连接电脑');assert.equal(await page.locator('.result-item').count(),0);assert((await page.locator('.evidence-plan').innerText()).includes('不回答操作教程'));
  });
  await check('located English passage never certifies the existing Chinese quote',async()=>{
   await page.goto(base+'/source-fixture.html?id=5');await page.locator('.evidence-passage').waitFor();
   const text=await page.locator('#workEvidence').innerText();assert(text.includes('Chapter LVIII'));assert(text.includes('原文与中文版本待核验'));assert(text.includes('编辑概述，非出版译文'));
   assert((await page.locator('.evidence-passage a').getAttribute('href')).startsWith('https://www.gutenberg.org/'));
  });
  await check('Hours relationship is rendered as editorial, not direct adaptation',async()=>{
   await page.goto(base+'/source-fixture.html?id=15');await page.locator('.evidence-sources').waitFor();
   assert((await page.locator('#workEvidence').innerText()).includes('不是《到灯塔去》的直接改编'));
  });
  await check('untrusted source and witness strings remain inert text',async()=>{
   const result=await page.evaluate(()=>{
    const match={type:'partial',matchedTerms:['<img src=x onerror="window.injected=1">'],missingTerms:[],unresolvedTerms:[],witnesses:[{fieldLabel:'<script>x</script>',term:'a',start:0,end:1,excerpt:'<img src=x onerror="window.injected=1">'}]};
    const element=AnchorEvidence.renderMatch(match);document.body.append(element);
    return {images:element.querySelectorAll('img').length,injected:window.injected||0,url:AnchorEvidence.safeUrl('javascript:alert(1)')};
   });assert.deepEqual(result,{images:0,injected:0,url:null});
  });
  await check('late search responses do not replace the latest query',async()=>{
   await page.goto(base+'/search.html');
   await page.route('**/api/search?*',async route=>{const response=await route.fetch();if(new URL(route.request().url()).searchParams.get('q')==='雨夜')await new Promise(r=>setTimeout(r,250));await route.fulfill({response});});
   await page.evaluate(()=>{document.getElementById('searchInput').value='雨夜';executeSearch();document.getElementById('searchInput').value='情书';executeSearch();});
   await page.waitForFunction(()=>document.querySelector('.evidence-plan')?.textContent.includes('情书'));
   await page.waitForTimeout(400);assert((await page.locator('.evidence-plan').innerText()).includes('情书'));
   assert(!(await page.locator('[data-result-group="primary"]').innerText()).includes('花样年华'));await page.unroute('**/api/search?*');
  });
  const report={schemaVersion:1,testedAt:new Date().toISOString(),scope:'Real Chromium + isolated native HTTP harness + production search service + real SQLite. Not full Express/auth; not live providers or video playback.',runtime:{node:process.version,playwright:require('playwright/package.json').version,chromium:browser.version()},cases,pageErrors:errors,passed:cases.every(c=>c.passed)&&!errors.length};
  const output=path.join(root,'docs/stage2/browser-contract.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDb();}
}
main().catch(error=>{console.error(error);server.close();closeDb();process.exitCode=1;});
