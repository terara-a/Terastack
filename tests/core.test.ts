import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documents, overlap} from '../collector/core.ts';
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
  assert.equal(result[0].name, 'draft-new-name');
  assert.ok(!calls[0].includes('gnap'));
});
test('rejects off-origin pagination', async () => {
  const fake = async () => Response.json({objects: [], meta: {next: 'https://evil.example/api/'}});
  await assert.rejects(async () => { for await (const doc of documents(undefined, fake as typeof fetch)) void doc; }, /destination/);
});
test('overlap includes three days before the last successful collection', async () => {
  assert.equal(overlap('2026-11-03T00:00:00Z'), '2026-10-31T00:00:00.000Z');
});
test('RFC 7636 appendix B PKCE vector', async () => {
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  await assert.rejects(challenge('too-short'));
});
test('Worker routes health and requires configured persistent issuer', async () => {
  assert.equal((await worker.fetch(new Request('https://example.test/health'))).status,200);
  assert.equal((await worker.fetch(new Request('https://example.test/token',{method:'POST'}))).status,503);
  assert.equal((await worker.fetch(new Request('https://example.test/examples/pkce'))).status,404);
});

import {empty, ingest, encode} from '../collector/state.ts';
import {collect} from '../collector/run.ts';
import {mkdtemp, readFile, readdir, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const draft = {name: 'draft-unknown-name', rev: '00', time: '2026-11-01', title: 'New access protocol', abstract: 'Large abstract', resource_uri: '/api/doc/1/'};
test('compact index retains latest version and invalidates stale decisions', () => {
  const state = empty();
  assert.equal(ingest(state, draft), true);
  state.index[draft.name][2] = true; // Historical compact-v2 slot; no active classifier reads it.
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
  assert.deepEqual(state.index.rfc9635.slice(0, 3), ['', '', null]);
});
test('repeat collection is a no-op; remote failure never advances checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terastack-'));
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
    await rm(root, {recursive: true});
  }
});

test('unsupported legacy catalogs are rejected before network access or writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-schema-'));
  try {
    await mkdir(`${root}/catalog`);
    const before = JSON.stringify({entries:{}});
    await writeFile(`${root}/catalog/state.json`,before);
    const source = async function* () { throw new Error('Network must not run'); };
    await assert.rejects(collect(root,source), /compact catalog v2/);
    assert.equal(await readFile(`${root}/catalog/state.json`,'utf8'),before);
  } finally { await rm(root,{recursive:true}); }
});
