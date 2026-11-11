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
    await cp('site',`${root}/site`,{recursive:true}); await cp('src',`${root}/src`,{recursive:true}); await cp('examples',`${root}/examples`,{recursive:true}); await mkdir(`${root}/catalog`);
    await writeFile(`${root}/catalog/state.json`,JSON.stringify({version:2,index:{rfc1:['','',null]}}));
    await writeFile(`${root}/catalog/private-key.txt`,'NEVER-PUBLISH');
    await mkdir(`${root}/reports/evaluation`,{recursive:true});
    await writeFile(`${root}/reports/evaluation/latest.json`,'not valid JSON: legacy data must not be read');
    await buildPages(root); const first=await readFile(`${root}/dist/data.json`,'utf8'); await buildPages(root);
    assert.equal(await readFile(`${root}/dist/data.json`,'utf8'),first);
    assert.deepEqual((await readdir(`${root}/dist`)).sort(),['.nojekyll','app.js','data.json','index.html','samples','style.css']);
    assert.ok(!first.includes('NEVER-PUBLISH'));
    assert.ok((await readFile(`${root}/dist/samples/pkce/index.html`,'utf8')).includes('認可コード'));
    assert.equal(await readFile(`${root}/dist/samples/pkce/worker.ts.txt`,'utf8'),await readFile('src/worker.ts','utf8'));
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
