#!/usr/bin/env node
'use strict';
// Same frozen 40 queries, two explicitly DIFFERENT interpretations of results:
// primary text matches vs discovery including labelled partial suggestions.
// Neither is a representative accuracy estimate or a semantic-model benchmark.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const corpusHash = hash(fs.readFileSync(path.join(root, 'data/seed-works.json')));
const fixtures = ['retrieval-cases.json','retrieval-holdout-cases.json'].map((name) => {
 const bytes=fs.readFileSync(path.join(root,'test/fixtures',name)); const f=JSON.parse(bytes);
 if(f.corpus.sha256 !== corpusHash) throw Error('Frozen corpus changed; re-review labels before evaluation');
 return {name,sha256:hash(bytes),fixture:f};
});
process.env.DB_PATH=':memory:';
const {getDb,closeDb}=require('../server/db');
const {searchLocalWorks,searchLocalWorksDetailed}=require('../server/services/worksRepository');
const title=w=>w.literatureTitle||w.movieTitle;
function check(c,results){
 if(c.check==='review_only') return 'review';
 const ts=results.map(title), top=ts.slice(0,c.check==='top1'?1:(c.k||3));
 let pass;
 if(c.check==='empty') pass=!ts.length;
 else if(c.check==='topk_all') pass=c.expectedTitles.every(t=>top.includes(t));
 else pass=c.expectedTitles.some(t=>top.includes(t)) && !(c.forbiddenTitles||[]).some(t=>ts.includes(t));
 return pass?'pass':'fail';
}
function summary(rows,key){return rows.reduce((s,r)=>{s[r[key]]++;return s;},{pass:0,fail:0,review:0});}
try {
 const db=getDb();
 const cases=fixtures.flatMap(({name,fixture})=>fixture.cases.map(c=>{
  const baseline=searchLocalWorks(db,c.query); const data=searchLocalWorksDetailed(db,c.query);
  const discovered=[...data.results,...data.partialResults];
  return {id:c.id,fixture:name,category:c.category,query:c.query,check:c.check,expectedTitles:c.expectedTitles,
   legacyCandidateOutcome:check(c,baseline),primaryOnlyOutcome:check(c,data.results),includingPartialOutcome:check(c,discovered),
   queryPlan:data.queryPlan,
   primary:data.results.map(w=>({title:title(w),movieTitle:w.movieTitle,match:w.match})),
   partial:data.partialResults.map(w=>({title:title(w),movieTitle:w.movieTitle,match:w.match}))};
 }));
 const report={schemaVersion:1,basePr:1,baseCommit:'688b104c6bcebddcf27f59b603e0441da1ff144c',evaluatedAt:new Date().toISOString(),
  runtime:{node:process.version,icu:process.versions.icu},corpusSha256:corpusHash,
  fixtures:fixtures.map(({name,sha256})=>({name,sha256})),
  implementationHashes:Object.fromEntries(['server/services/queryEvidence.js','server/services/worksRepository.js','server/services/contentEvidence.js'].map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),
  note:'The same old relevance checks are separately applied to primary-only and primary+partial lists. A partial suggestion is not a complete answer. The old snow/dress empty check intentionally passes primary-only but fails including-partial. Raw counts must not be presented as one comparable accuracy metric. All relevance labels come from the legacy unverified seed text.',
  summary:{legacyCandidates:summary(cases,'legacyCandidateOutcome'),primaryOnly:summary(cases,'primaryOnlyOutcome'),includingPartial:summary(cases,'includingPartialOutcome')},cases};
 const oi=process.argv.indexOf('--output');const output=oi>=0?process.argv[oi+1]:path.join(root,'docs/stage2/retrieval-contract.json');
 if(!output)throw Error('--output requires a filename');fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary,null,2));
 console.log('Primary-only failures:',cases.filter(c=>c.primaryOnlyOutcome==='fail').map(c=>c.query).join(' | '));
 if(process.argv.includes('--strict') && cases.some(c=>c.primaryOnlyOutcome==='fail'))process.exitCode=1;
} finally {closeDb();}
