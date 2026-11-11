import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedPath,eligible,validateData} from '../scripts/merge-catalog.ts';
const pr={state:'open',draft:false,base:{ref:'main',sha:'a'.repeat(40)},head:{ref:'standards/daily',sha:'b'.repeat(40),repo:{full_name:'terara-a/Terastack'}},user:{type:'Bot',login:'github-actions[bot]'}};
test('only generated data paths are allowed, never code, reviews or rules',()=>{
 for(const path of ['catalog/state.json','catalog/candidates.json','catalog/semantic-index.json','reports/daily/2026-11-11.json','reports/semantic/progress.json']) assert.equal(allowedPath(path),true,path);
 for(const path of ['catalog/reviewed.json','semantic/config.json','site/app.js','.github/workflows/daily.yml','reports/../../site/app.js','reports/semantic/script.json']) assert.equal(allowedPath(path),false,path);
});
test('only same-repository bot data PRs targeting main are eligible',()=>{
 assert.doesNotThrow(()=>eligible(pr,'terara-a/Terastack'));
 for(const invalid of [{...pr,draft:true},{...pr,user:{type:'User',login:'github-actions[bot]'}},{...pr,head:{...pr.head,repo:{full_name:'other/repo'}}},{...pr,base:{...pr.base,ref:'other'}}]) assert.throws(()=>eligible(invalid,'terara-a/Terastack'));
});
test('invalid scores, incomplete evaluation and failed reports require review',()=>{
 assert.doesNotThrow(()=>validateData('catalog/state.json',{version:2,index:{rfc1:['','',null]}}));
 assert.throws(()=>validateData('catalog/state.json',{version:2,index:{rfc1:['','','yes']}}));
 assert.throws(()=>validateData('catalog/semantic-index.json',{signature:'x',entries:{rfc1:['fp','NaN']}}));
 assert.throws(()=>validateData('reports/semantic/evaluation.json',{status:'passed',metrics:{recall:.8,precision:1}}));
 assert.throws(()=>validateData('reports/semantic/progress.json',{status:'failed'}));
 assert.doesNotThrow(()=>validateData('reports/semantic/evaluation.json',{status:'passed',metrics:{recall:1,precision:.9}}));
});
