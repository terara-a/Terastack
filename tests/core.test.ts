import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documents, overlap, classify, revisionKey} from '../collector/core.ts';
import worker, {challenge} from '../src/worker.ts';
test('all-topic discovery follows pagination and retains unknown protocol names', async () => {
  const calls: string[] = [];
  const fake = async (url: any) => {
    calls.push(String(url));
    return Response.json({objects: [{name: calls.length === 1 ? 'draft-new-name' : 'draft-ietf-gnap-core-protocol', rev: '01', time: '2026-11-03', title: 'Access delegation'}], meta: {next: calls.length === 1 ? '/api/v1/doc/document/?offset=100' : null}});
  };
  const result = [];
  for await (const doc of documents(undefined, fake as typeof fetch)) result.push(doc);
  assert.equal(result.length, 2);
  assert.equal(revisionKey(result[0]), 'draft-new-name-01');
  assert.ok(!calls[0].includes('gnap'));
});
test('rejects off-origin pagination', async () => {
  const fake = async () => Response.json({objects: [], meta: {next: 'https://evil.example/api/'}});
  await assert.rejects(async () => { for await (const doc of documents(undefined, fake as typeof fetch)) void doc; }, /destination/);
});
test('overlap and unconfigured semantic classification preserve review candidates', async () => {
  assert.equal(overlap('2026-11-03T00:00:00Z'), '2026-10-31T00:00:00.000Z');
  const decision = await classify({name: 'draft-unknown', rev: '00', time: '', title: '', resource_uri: ''}, {});
  assert.equal(decision.relevant, null);
});
test('RFC 7636 appendix B PKCE vector', async () => {
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  await assert.rejects(challenge('too-short'));
});
test('Worker functional request and invalid verifier', async () => {
  assert.equal((await worker.fetch(new Request('https://example.test/health'))).status, 200);
  const response = await worker.fetch(new Request('https://example.test/examples/pkce', {method: 'POST', body: JSON.stringify({verifier: 'a'.repeat(43)})}));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).code_challenge_method, 'S256');
  assert.equal((await worker.fetch(new Request('https://example.test/examples/pkce', {method: 'POST', body: '{}'}))).status, 400);
});

import {empty, ingest, migrate, encode, setDecision} from '../collector/state.ts';
import {collect} from '../collector/run.ts';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const draft = {name: 'draft-unknown-name', rev: '00', time: '2026-11-01', title: 'New access protocol', abstract: 'Large abstract', resource_uri: '/api/doc/1/'};
test('compact index retains latest version and invalidates stale decisions', () => {
  const state = empty(); const related = {};
  assert.equal(ingest(state, draft), true);
  setDecision(state, related, draft, {relevant: true, reason: 'Access delegation'}, 'v1', '2026-11-01');
  assert.equal(ingest(state, draft), false);
  assert.equal(ingest(state, {...draft, rev: '01'}), true);
  assert.equal(state.index[draft.name][2], null);
  assert.ok(!encode(state).includes('Large abstract'));
});
test('RFC identity is independent of publication order and mutable metadata', () => {
  const state = empty();
  assert.equal(ingest(state, {...draft, name: 'rfc9767', rev: ''}), true);
  assert.equal(ingest(state, {...draft, name: 'rfc9635', rev: ''}), true);
  assert.equal(ingest(state, {...draft, name: 'rfc9767', rev: '', time: '2026-11-04'}), false);
  assert.deepEqual(state.index.rfc9635, ['', '', null]);
});
test('legacy migration preserves every identity, latest revision and decisions', () => {
  const old = {lastSuccess: '2026-11-01', entries: {
    first: {document: {...draft, rev: '01'}, decision: {relevant: false, reason: 'Unrelated'}, classifiedAt: '2026-11-01'},
    older: {document: draft, decision: {relevant: null, reason: 'Pending'}},
    rfc: {document: {...draft, name: 'rfc9635', rev: ''}, decision: {relevant: true, reason: 'GNAP'}}
  }};
  const {state, related} = migrate(old);
  assert.equal(Object.keys(state.index).length, 2);
  assert.equal(state.index[draft.name][0], '01');
  assert.equal(state.index[draft.name][2], false);
  assert.equal(related.rfc9635.reason, 'GNAP');
  assert.equal(encode(migrate(state).state), encode(state));
});
test('repeat collection is a no-op; remote failure never advances checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terastack-'));
  const saved = {...process.env};
  delete process.env.CLASSIFIER_URL; delete process.env.CLASSIFIER_API_KEY; delete process.env.CLASSIFIER_MODEL;
  const source = async function* (_since: any, _fetch: any, type: string) {
    yield type === 'draft' ? draft : {...draft, name: 'rfc9635', rev: ''};
  };
  try {
    await collect(root, source);
    const before = await readFile(`${root}/catalog/state.json`, 'utf8');
    const reports = await readdir(`${root}/reports/daily`);
    const reportBefore = await readFile(`${root}/reports/daily/${reports[0]}`, 'utf8');
    await collect(root, source);
    assert.equal(await readFile(`${root}/catalog/state.json`, 'utf8'), before);
    assert.equal(await readFile(`${root}/reports/daily/${reports[0]}`, 'utf8'), reportBefore);
    const broken = async function* () { yield {...draft, rev: '02'}; throw new Error('Remote outage'); };
    await assert.rejects(collect(root, broken), /Remote outage/);
    assert.equal(await readFile(`${root}/catalog/state.json`, 'utf8'), before);
    assert.ok(!reportBefore.includes('Large abstract'));
  } finally {
    for (const key of ['CLASSIFIER_URL', 'CLASSIFIER_API_KEY', 'CLASSIFIER_MODEL']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(root, {recursive: true});
  }
});
