import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicData, buildPages} from '../scripts/build-pages.ts';
test('public snapshot contains related documents and counts, never raw index or private fields', () => {
  const data = publicData({version:2,lastSuccess:'2026-11-11T00:00:00Z',index:{rfc9635:['','',true],rfc1:['','',false],'draft-new':['00','',null]}},
    [{started:'2026-11-11T00:00:00Z',changedCount:3,secret:'DO-NOT-PUBLISH'}], {
    rfc9635:{status:'confirmed',rev:'',title:'GNAP',reason:'Delegated access',url:'javascript:alert(1)',secret:'DO-NOT-PUBLISH'},rfc1:{status:'excluded'},'bad<script>':{status:'confirmed',title:'Bad'}
  });
  assert.deepEqual(data.counts,{total:3,rfc:2,draft:1,relevant:1,unrelated:1,pending:1});
  assert.equal(data.documents.length,1); assert.equal(data.documents[0].url,'https://datatracker.ietf.org/doc/rfc9635/');
  assert.equal(data.daily[0].changed,3); assert.ok(!('evaluationStatus' in data));
  assert.ok(!JSON.stringify(data).includes('DO-NOT-PUBLISH')); assert.ok(!('index' in data));
});
test('history is newest first and bounded; empty catalogs remain honest', () => {
  const reports = Array.from({length:35},(_,i)=>({started:new Date(Date.UTC(2026,0,i+1)).toISOString(),changedCount:i,relevant:[]}));
  const data = publicData({version:2,index:{}},reports);
  assert.equal(data.daily.length,30); assert.equal(data.daily[0].changed,34);
  assert.equal(data.counts.total,0); assert.deepEqual(data.documents,[]); assert.ok(!('evaluationStatus' in data));
});
test('site build is repeatable and publishes only whitelisted static files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pages-'));
  try {
    await cp('site',`${root}/site`,{recursive:true}); await mkdir(`${root}/catalog`);
    await writeFile(`${root}/catalog/state.json`,JSON.stringify({version:2,index:{rfc1:['','',null]}}));
    await writeFile(`${root}/catalog/private-key.txt`,'NEVER-PUBLISH');
    await mkdir(`${root}/reports/evaluation`,{recursive:true});
    await writeFile(`${root}/reports/evaluation/latest.json`,'not valid JSON: legacy data must not be read');
    await buildPages(root); const first=await readFile(`${root}/dist/data.json`,'utf8');
    await writeFile(`${root}/dist/samples/pkce/obsolete-source.txt`,'removed source');
    await buildPages(root);
    assert.equal(await readFile(`${root}/dist/data.json`,'utf8'),first);
    assert.deepEqual((await readdir(`${root}/dist`)).sort(),['.nojekyll','app.js','data.json','favicon.png','favicon.svg','index.html','samples','style.css']);
    assert.ok(!first.includes('NEVER-PUBLISH'));
    assert.ok((await readFile(`${root}/dist/samples/pkce/index.html`,'utf8')).includes('認可コード'));
    assert.deepEqual((await readdir(`${root}/dist/samples/pkce`)).sort(),['client.js','code.html','code.js','index.html','protocol.js','sample.css']);
    const html=await readFile(`${root}/dist/index.html`,'utf8'); assert.ok(html.includes('href="./style.css"')); assert.ok(html.includes('src="./app.js"'));
  } finally { await rm(root,{recursive:true}); }
});
test('reviewed specifications override candidates and excluded or stale revisions are hidden',()=>{
 const state={version:2,index:{rfc9635:['','',null],'draft-new':['02','today',null],rfc1:['','',null]}};
 const reviewed={rfc9635:{status:'confirmed',title:'GNAP',rev:'',reason:'Reviewed'},rfc1:{status:'excluded'},'draft-new':{status:'confirmed',rev:'01',title:'Old review'}};
 const candidates={rfc9635:{rev:'',title:'Machine'},rfc1:{rev:'',title:'Excluded'},'draft-new':{rev:'01',time:'yesterday',title:'Stale'}};
 const result=publicData(state,[],reviewed,candidates,{screened:3});
 assert.equal(result.documents.length,1); assert.equal(result.documents[0].status,'confirmed'); assert.equal(result.documents[0].title,'GNAP');
 assert.equal(result.review.confirmed,1); assert.equal(result.review.unreviewed,1);
 const candidate=publicData(state,[],{}, {'draft-new':{rev:'02',time:'today',title:'Current candidate',reason:'Similar'}});
 assert.equal(candidate.documents[0].status,'candidate');
});

test('OpenID appears by source and publication stage without becoming human-confirmed',()=>{
 const openid={lastSuccess:'2026-11-11T00:00:00Z',documents:{'new-01':{title:'Unknown OpenID protocol',url:'https://openid.net/specs/new-01.html',stage:"Implementer's Draft",revision:'01',listed:true,checkedAt:'2026-11-11T00:00:00Z',etag:'PRIVATE-CACHE'},retired:{listed:false}}};
 const data=publicData({version:2,index:{rfc1:['','',null]}},[],{},{},null,openid);
 assert.equal(data.counts.total,2);assert.equal(data.openidCount,1);assert.equal(data.review.confirmed,0);assert.equal(data.review.unreviewed,2);
 assert.equal(data.documents[0].source,'OpenID Foundation');assert.equal(data.documents[0].stage,"Implementer's Draft");assert.equal(data.documents[0].status,'listed');
 assert.equal(data.openidCollection,openid.lastSuccess);assert.ok(!JSON.stringify(data).includes('PRIVATE-CACHE'));
 assert.throws(()=>publicData({version:2,index:{}},[],{},{},null,{documents:{evil:{listed:true,title:'bad',url:'javascript:alert(1)'}}}));
});

const openidName='openid-connect-core-1_0';
const openidDoc={title:'Collected title',url:`https://openid.net/specs/${openidName}.html`,revision:'1_0',stage:'Final',listed:true,sha256:'a'.repeat(64),checkedAt:'2026-11-12T00:00:00Z'};
const openidDecision={status:'confirmed',url:openidDoc.url,rev:'1_0',sha256:openidDoc.sha256,title:'Reviewed title',reason:'原文を確認し、認証結果を伝える仕様であることを確認した。',reviewedAt:'2026-11-12T09:00:00+09:00',reviewedBy:'OpenAI Codex（AI）'};
const openidReviews=(patch={})=>({[`openid:${openidName}`]:{...openidDecision,...patch}});
const withReview=(reviews:any,patch={},documents:any=null)=>publicData({version:2,index:{}},[],reviews,{},null,{documents:documents ?? {[openidName]:{...openidDoc,...patch}}});

test('OpenID confirmation requires exact URL, revision and body hash; timestamps do not invalidate it',()=>{
 const data=withReview(openidReviews(),{checkedAt:'2026-11-13T00:00:00Z',etag:'new HTTP validator',title:'Changed listing title'});
 assert.equal(data.documents[0].status,'confirmed');assert.equal(data.documents[0].reason,openidDecision.reason);assert.equal(data.documents[0].title,'Reviewed title');
 assert.equal(data.documents[0].reviewedAt,openidDecision.reviewedAt);assert.equal(data.documents[0].reviewedBy,'OpenAI Codex（AI）');
 assert.equal(data.review.confirmed,1);assert.equal(data.review.listed,0);assert.equal(data.review.unreviewed,0);assert.equal(data.counts.pending,0);
 assert.ok(!JSON.stringify(data).includes(openidDoc.sha256));
});
test('changed or missing OpenID body and changed revision become needs_review without rewriting human decisions',()=>{
 const reviews=openidReviews();const before=JSON.stringify(reviews);
 for(const patch of [{sha256:'b'.repeat(64)},{sha256:undefined},{sha256:'malformed'},{revision:'1_1'}]) {
  const data=withReview(reviews,patch);
  assert.equal(data.documents[0].status,'needs_review');assert.equal(data.documents[0].title,openidDoc.title);assert.ok(data.documents[0].reviewNotice);
  assert.equal(data.review.confirmed,0);assert.equal(data.review.needsReview,1);assert.equal(data.review.unreviewed,1);
 }
 assert.equal(JSON.stringify(reviews),before);
});
test('OpenID exclusions are bound to the same fingerprint and reopen when changed',()=>{
 const reviews=openidReviews({status:'excluded'});
 const data=withReview(reviews);
 assert.equal(data.documents.length,0);assert.equal(data.openidCount,1);assert.equal(data.counts.total,1);assert.equal(data.counts.unrelated,1);assert.equal(data.counts.pending,0);
 const updated=withReview(reviews,{sha256:'b'.repeat(64)});
 assert.equal(updated.documents[0].status,'needs_review');assert.equal(updated.counts.unrelated,0);assert.equal(updated.counts.pending,1);
});
test('a new OpenID URL never inherits another edition review and removed entries stay hidden',()=>{
 const other='openid-connect-core-1_1';
 const data=withReview(openidReviews(),{}, {[openidName]:{...openidDoc,listed:false},[other]:{...openidDoc,url:`https://openid.net/specs/${other}.html`,revision:'1_1'}});
 assert.equal(data.documents.length,1);assert.equal(data.documents[0].name,other);assert.equal(data.documents[0].status,'listed');assert.equal(data.review.confirmed,0);
 assert.equal(withReview({[openidName]:openidDecision}).documents[0].status,'listed');
});
test('invalid OpenID review records fail the build instead of confirming or hiding documents',()=>{
 for(const patch of [{status:'listed'},{reviewedBy:42},{reviewedBy:' '},{url:'https://evil.example/spec'},{rev:undefined},{sha256:undefined},{sha256:'bad'},{reason:' '},{title:''},{reviewedAt:'today'},{reviewedAt:'2026-11-12T00:00:00'}]) assert.throws(()=>withReview(openidReviews(patch)),/Invalid OpenID review/);
 assert.throws(()=>withReview({'openid:../bad':openidDecision}),/Invalid OpenID review/);
});

test('legacy OpenID review without attribution remains supported without inventing a reviewer',()=>{
 const reviews=openidReviews();delete reviews[`openid:${openidName}`].reviewedBy;
 const data=withReview(reviews);assert.equal(data.documents[0].status,'confirmed');assert.ok(!('reviewedBy' in data.documents[0]));
});
