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
