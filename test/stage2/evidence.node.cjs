'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getDb, closeDb } = require('../../server/db');
const { searchLocalWorksDetailed: search, getWork, insertExternalWork } = require('../../server/services/worksRepository');
const { buildSearchResponse } = require('../../server/services/searchService');
const { indexedText, findWitnesses, fieldsFor } = require('../../server/services/queryEvidence');
const { contentEvidenceFor, validateSegment, validateCatalogue } = require('../../server/services/contentEvidence');
const catalogue = require('../../data/evidence-catalogue.json');
let db, previousPath;
beforeEach(() => { closeDb(); previousPath = process.env.DB_PATH; process.env.DB_PATH = ':memory:'; db = getDb(); });
afterEach(() => { closeDb(); if (previousPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previousPath; });
const title = (w) => w.movieTitle || w.literatureTitle;
const all = (r) => [...r.results, ...r.partialResults];
const add = (fields) => insertExternalWork(db, { sourceType: 'synthetic', kind: 'book', literatureTitle: '合成记录', description: '', keywords: [], ...fields });

test('snow and emerald dress are separately labelled partial results, not a fabricated complete match', () => {
 const r=search(db,'雪地里穿祖母绿裙子'); assert.equal(r.results.length,0);
 const a=r.partialResults.find(w=>title(w)==='赎罪'), b=r.partialResults.find(w=>title(w)==='情书');
 assert(a && b); assert(a.match.missingTerms.includes('雪地')); assert(b.match.missingTerms.includes('祖母绿'));
 assert(all(r).every(w=>w.match.type==='partial' && w.match.sameSceneVerified===false));
});
test('one record can satisfy all lexical conditions without claiming one verified scene',()=>{
 const r=search(db,'金色香槟舞会'); assert.equal(title(r.results[0]),'了不起的盖茨比');
 assert.equal(r.results[0].match.type,'all_text_conditions'); assert.equal(r.results[0].match.sameSceneVerified,false);
 assert(r.partialResults.some(w=>title(w)==='安娜·卡列尼娜'));
});
test('a simple rainy-night query remains discoverable',()=>assert.equal(title(search(db,'雨夜').results[0]),'花样年华'));
for(const q of ['绿色激光测距仪怎么校准','粉色无线耳机怎么连接电脑','蓝色路由器如何配置','如何训练目标检测模型','红烧牛肉面做法']) {
 test(`procedure intent abstains without colour recommendations: ${q}`,()=>{ const r=search(db,q);assert.equal(r.queryPlan.intent,'outside_scope');assert.equal(all(r).length,0); });
}
test('unknown objects in a descriptive query remain unresolved, not silently dropped',()=>{
 const r=search(db,'粉色耳机');assert.equal(r.results.length,0);assert(r.queryPlan.unresolvedTerms.includes('耳机'));
 assert(r.partialResults.every(w=>w.match.type==='partial'));
});
test('explicit exclusions apply to both result groups',()=>{
 const r=search(db,'有雪但不要火车');assert(r.results.some(w=>title(w)==='情书'));assert(!all(r).some(w=>title(w)==='安娜·卡列尼娜'));
});
test('descriptive negation does not become an exclusion or a fully understood semantic request',()=>{
 const r=search(db,'想找雨夜里没有说出口的告别');assert.equal(r.queryPlan.excludedTerms.length,0);assert.equal(r.results.length,0);
 assert(r.partialResults.some(w=>title(w)==='花样年华'));assert(r.partialResults.some(w=>title(w)==='告别有情天'));
});
test('unsupported disjunction is explicitly left for review',()=>{
 const r=search(db,'雨夜或者雪地');assert.equal(r.queryPlan.logic,'needs_review');assert.equal(r.results.length,0);
});
for(const name of ['不要关闭灯塔','我们','绿色激光测距仪怎么校准']) {
 test(`complete metadata overrides command-shaped wording: ${name}`,()=>{
  const w=add({literatureTitle:name});const r=search(db,name);assert.deepEqual(r.results.map(x=>x.id),[w.id]);assert.equal(r.queryPlan.intent,'known_item');
 });
}
test('duplicate titles do not collapse separate records in the result contract',()=>{
 const w=add({sourceType:'synthetic-a',literatureTitle:'同名作品'});const v=add({sourceType:'synthetic-b',literatureTitle:'同名作品'});
 assert.deepEqual(new Set(search(db,'同名作品').results.map(x=>x.id)),new Set([w.id,v.id]));
});
test('all creator-name matches survive',()=>{
 assert.deepEqual(new Set(search(db,'乔·赖特').results.map(title)),new Set(['赎罪','傲慢与偏见','安娜·卡列尼娜']));
});
test('no term is manufactured by joining keyword fields',()=>{
 db.exec('DELETE FROM works');add({keywords:['麦田','野营']});assert.equal(all(search(db,'田野')).length,0);
});
test('old records are evaluated before limiting results',()=>{
 const target=add({literatureTitle:'原始钟楼',keywords:['紫藤钟楼']});
 db.exec('BEGIN');for(let n=0;n<501;n++)add({literatureTitle:`合成${n}`});db.exec('COMMIT');
 assert(search(db,'紫藤钟楼').results.some(w=>w.id===target.id));
});
test('normalized UTF-16 offsets map back to the real original field',()=>{
 const raw='🎞️ ＡＢＣ 在雨夜里';const f={field:'description',...indexedText(raw)};const [w]=findWitnesses([f],'abc');
 assert.equal(raw.slice(w.start,w.end),'ＡＢＣ');assert.equal(w.matchedText,'ＡＢＣ');
});
test('every returned witness is an actual span from the stated field',()=>{
 for(const q of ['雨夜','祖母绿裙子','金色香槟舞会','乔·赖特']) for(const w of all(search(db,q))) for(const e of w.match.witnesses) {
  const values=e.field==='keyword'?w.keywords:[w[e.field]];
  assert(values.some(v=>v.slice(e.start,e.end)===e.matchedText));
 }
});
test('provider query echo is not independently admissible evidence',()=>{
 add({sourceType:'open_library',literatureTitle:'外部记录',keywords:['碧色独木桥'],description:'普通书目介绍'});
 assert.equal(all(search(db,'碧色独木桥')).length,0);
});
test('all sixteen unchanged records receive current source metadata without certifying their quotes',()=>{
 for(const row of db.prepare('SELECT id FROM works').all()) {
  const e=getWork(db,row.id).contentEvidence;assert.equal(e.catalogueStatus,'current');assert.equal(e.quote.status,'unverified');
  assert.equal(e.sameSceneVerified,false);assert(e.videos.every(v=>v.segments.length===0 && v.status==='unverified'));
 }
});
test('two reference-version passages are distinguished from existing Chinese quotations',()=>{
 const a=search(db,'傲慢与偏见').results[0].contentEvidence;
 assert.equal(a.locatedPassages.length,1);assert.equal(a.quote.status,'unverified');assert.equal(a.locatedPassages[0].source.language,'en');
 assert.equal(search(db,'追忆似水年华').results[0].contentEvidence.locatedPassages[0].source.translator,'C. K. Scott Moncrieff');
});
test('the Hours pair is editorial, not a false To the Lighthouse adaptation',()=>{
 const e=search(db,'时时刻刻').results[0].contentEvidence;
 assert.equal(e.relationship.type,'editorial_theme');assert.equal(e.relationship.status,'editorial');assert.equal(e.relationship.sources.length,1);
});
test('a changed excerpt invalidates the source snapshot',()=>{
 const w=search(db,'傲慢与偏见').results[0];const e=contentEvidenceFor({...w,quote:'合成替换，不是原引文'});
 assert.equal(e.catalogueStatus,'stale');assert.equal(e.locatedPassages.length,0);assert.equal(e.relationship.status,'unverified');
});
test('a different release cannot inherit another film edition evidence',()=>{
 const w=search(db,'傲慢与偏见').results[0];assert.equal(contentEvidenceFor({...w,movieYear:2099}).catalogueStatus,'not_catalogued');
});
test('catalogue rejects duplicate identities',()=>{
 const copy=structuredClone(catalogue);copy.entries.push(copy.entries[0]);assert.throws(()=>validateCatalogue(copy));
});
test('catalogue rejects altered source excerpts unless their fingerprints are deliberately updated',()=>{
 const copy=structuredClone(catalogue);copy.entries[4].locatedPassages[0].sourceExcerpt+=' altered';assert.throws(()=>validateCatalogue(copy));
});
test('catalogue rejects active-code URLs',()=>{
 const copy=structuredClone(catalogue);copy.entries[4].locatedPassages[0].source.url='javascript:alert(1)';assert.throws(()=>validateCatalogue(copy));
});
const media={sourceUrl:'https://example.org/synthetic-fixture.mp4',mediaSha256:'a'.repeat(64),durationSeconds:10,rightsStatus:'reviewed'};
const segment={startSeconds:1,endSeconds:3,referenceFrameSeconds:2,annotation:'SYNTHETIC schema test, not real footage',tags:['synthetic'],status:'reviewed',reviewedBy:'synthetic-test',reviewedAt:'2026-10-19'};
test('synthetic segment passes structural validation only',()=>assert.deepEqual(validateSegment(segment,media),[]));
for(const change of [{startSeconds:null},{startSeconds:-1},{endSeconds:0},{endSeconds:11},{referenceFrameSeconds:3},{reviewedBy:null}]) {
 test(`rejects invalid segment fields: ${JSON.stringify(change)}`,()=>assert(validateSegment({...segment,...change},media).length));
}
test('unknown media version, rights or timestamp cannot become a verified clip',()=>{
 assert(validateSegment(segment,{...media,mediaSha256:null,rightsStatus:'unverified',durationSeconds:null}).length>=3);
});
test('oversized or non-string queries fail explicitly',async()=>{
 for(const q of ['雪'.repeat(201),{query:'雨夜'}]) await assert.rejects(buildSearchResponse(db,q),e=>e.status===400);
});
test('external fallback is never called for exclusions, multi-condition queries or procedures',async()=>{
 let calls=0;const provider=async()=>{calls++;return[];};
 for(const q of ['有雪但不要火车','雪地里穿祖母绿裙子','绿色激光测距仪怎么校准']) await buildSearchResponse(db,q,{externalEnabled:true,searchBooks:provider,searchMovies:provider});
 assert.equal(calls,0);
});
test('external results stay separate and echoed keywords are not persisted',async()=>{
 const provider=async()=>[{sourceType:'open_library',kind:'book',literatureTitle:'外部某书',description:'外部书目而非场景证据',keywords:['琥珀','外部某书']}];
 const r=await buildSearchResponse(db,'琥珀',{externalEnabled:true,searchBooks:provider});
 assert.equal(r.results.length,0);assert.equal(r.externalResults.length,1);assert.equal(r.externalResults[0].match.type,'external_metadata');
 assert(!r.externalResults[0].keywords.includes('琥珀'));assert.equal(all(search(db,'琥珀')).length,0);
});

test('aggregated book providers retain both sources within the total external result limit', async () => {
 const books = ['open_library', 'google_books'].flatMap(sourceType =>
  Array.from({ length: 5 }, (_, index) => ({ sourceType, kind: 'book',
   literatureTitle: `${sourceType} synthetic ${index}`, keywords: [] })));
 const r = await buildSearchResponse(db, '琥珀', { externalEnabled: true,
  searchBooks: async () => [null, books[0], ...books],
  searchMovies: async () => [{ sourceType: 'tmdb', kind: 'movie', movieTitle: 'Synthetic extra movie' }] });
 assert.equal(r.externalResults.length, 10);
 assert.deepEqual(r.externalResults.map(work => work.literatureTitle), books.map(work => work.literatureTitle));
 assert(r.externalResults.every(work => work.match.type === 'external_metadata'));
});
test('a provider rejection does not discard local discovery',async()=>{
 const r=await buildSearchResponse(db,'雨夜',{externalEnabled:true,searchBooks:async()=>{throw Error('synthetic provider failure');}});
 assert(r.results.some(w=>title(w)==='花样年华'));assert.equal(r.externalStatus.books,'unavailable');
});

test('grammatical joins do not become unsupported content conditions',()=>{
 assert(search(db,'她在小樽的雪地里对着雪山呼喊').results.some(w=>title(w)==='情书'));
 assert(search(db,'蓝灰色海港').results.some(w=>title(w)==='海边的曼彻斯特'));
});
test('synchronous provider exceptions and malformed items do not break local discovery',async()=>{
 const r=await buildSearchResponse(db,'雨夜',{externalEnabled:true,searchBooks:()=>{throw Error('synthetic');},searchMovies:async()=>[null,{},'bad']});
 assert(r.results.some(w=>title(w)==='花样年华'));assert.equal(r.externalResults.length,0);
});

test('有没有 is a positive availability question, not descriptive negation',()=>{
 const r=search(db,'有没有那种长廊和镜子');
 assert(!r.queryPlan.requiredTerms.some(t=>t.startsWith('没有')));
 assert(r.results.some(w=>title(w)==='追忆似水年华'));
});
