import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documents, overlap, revisionKey} from '../collector/core.ts';
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
  assert.equal(configFromEnv({}), undefined);
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
  assert.deepEqual(state.index.rfc9635.slice(0, 3), ['', '', null]);
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

import {configFromEnv, prepare, reserve, execute, PROMPT_VERSION} from '../collector/model.ts';
import {queue, classifyPending} from '../collector/classify.ts';
import {metrics, EVALUATION_VERSION, evaluate} from '../collector/evaluate.ts';
import {mkdir, writeFile, copyFile} from 'node:fs/promises';
const config = {url: 'https://model.example/chat/completions', key: 'test-only', model: 'test-model', inputRate: 1, outputRate: 2, maxUSD: 1};
test('configuration fails closed without explicit prices; reservations prevent overspending', () => {
  assert.throws(() => configFromEnv({CLASSIFIER_URL: config.url, CLASSIFIER_API_KEY: 'test', CLASSIFIER_MODEL: 'test'}), /positive/);
  assert.throws(() => configFromEnv({CLASSIFIER_URL: 'http://model.example', CLASSIFIER_API_KEY: 'test', CLASSIFIER_MODEL: 'test'}), /HTTPS/);
  const batch = prepare([draft], config);
  assert.ok(batch.reserveUSD > 0);
  const ledger = {reservedUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0};
  assert.equal(reserve(ledger, batch, {...config, maxUSD: batch.reserveUSD / 2}), false);
  assert.equal(ledger.calls, 0);
  assert.equal(reserve(ledger, batch, config), true);
  assert.equal(ledger.reservedUSD, batch.reserveUSD);
});
test('daily queue prioritizes updates; uncertainty has a seven-day cooldown', () => {
  const state = empty();
  state.index['draft-old'] = ['00', '', null];
  state.index['rfc9999'] = ['', '', null, '', '', '2026-11-04'];
  state.index['draft-uncertain'] = ['00', '', null, 'v2', '2026-11-04T00:00:00Z'];
  state.index['draft-negative'] = ['00', '', false];
  assert.deepEqual(queue(state, 'daily', Date.parse('2026-11-04T01:00:00Z')), ['rfc9999', 'draft-old']);
  assert.ok(queue(state, 'daily', Date.parse('2026-11-12T00:00:00Z')).includes('draft-uncertain'));
});
test('batch parser rejects missing or duplicate names rather than dropping unknown protocols', async () => {
  const docs = [draft, {...draft, name: 'draft-new-protocol'}];
  const fetcher = async () => Response.json({choices: [{message: {content: JSON.stringify({decisions: docs.map(() => ({name: draft.name, relevant: true, reason: 'yes'}))})}}]});
  await assert.rejects(execute(prepare(docs, config), docs, config, fetcher as typeof fetch), /Invalid classifier/);
});
test('evaluation treats missed positives and uncertain positives as false negatives', () => {
  const measured = metrics([{name: 'a', expected: true}, {name: 'b', expected: true}, {name: 'c', expected: false}], new Map([
    ['a', {relevant: true, reason: ''}], ['b', {relevant: null, reason: ''}], ['c', {relevant: false, reason: ''}]
  ]));
  assert.equal(measured.recall, 0.5); assert.equal(measured.precision, 1); assert.equal(measured.uncertain, 1);
});
test('backfill checkpoints completed batches and reserves failed paid calls for safe resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classify-'));
  const savedLimit = process.env.CLASSIFY_LIMIT; process.env.CLASSIFY_LIMIT = '20';
  try {
    await mkdir(`${root}/catalog`); await mkdir(`${root}/reports/evaluation`, {recursive: true});
    const state = empty();
    for (let i = 0; i < 12; i++) state.index[`draft-${String(i).padStart(2, '0')}`] = ['00', '', null];
    await writeFile(`${root}/catalog/state.json`, encode(state)); await writeFile(`${root}/catalog/related.json`, '{}');
    await assert.rejects(classifyPending(root, 'backfill', config), /evaluation/);
    await writeFile(`${root}/reports/evaluation/latest.json`, JSON.stringify({status: 'passed', model: config.model, url: config.url, promptVersion: PROMPT_VERSION, fixtureVersion: EVALUATION_VERSION}));
    let calls = 0;
    const fetcher = async (url: any, options: any) => {
      if (String(url).startsWith('https://datatracker')) {
        const name = new URL(url).searchParams.get('name');
        return Response.json({objects: [{...draft, name}]});
      }
      calls++;
      if (calls === 2) return new Response('', {status: 503});
      const docs = JSON.parse(JSON.parse(options.body).messages[1].content);
      return Response.json({choices: [{message: {content: JSON.stringify({decisions: docs.map((d: any) => ({name: d.name, relevant: true, reason: 'Delegated access'}))})}}], usage: {prompt_tokens: 100, completion_tokens: 50}});
    };
    await assert.rejects(classifyPending(root, 'backfill', config, fetcher as typeof fetch), /HTTP 503/);
    const after = JSON.parse(await readFile(`${root}/catalog/state.json`, 'utf8'));
    assert.equal(Object.values(after.index).filter((r: any) => r[2] === true).length, 10);
    const ledger = JSON.parse(await readFile(`${root}/catalog/classification-budget.json`, 'utf8'));
    assert.equal(ledger.calls, 2); assert.ok(ledger.reservedUSD > 0);
    const beforeRequests = calls;
    await classifyPending(root, 'backfill', {...config, maxUSD: ledger.reservedUSD}, fetcher as typeof fetch);
    assert.equal(calls, beforeRequests);
    await classifyPending(root, 'backfill', config, fetcher as typeof fetch);
    const final = JSON.parse(await readFile(`${root}/catalog/state.json`, 'utf8'));
    assert.equal(Object.values(final.index).filter((r: any) => r[2] === true).length, 12);
  } finally {
    if (savedLimit === undefined) delete process.env.CLASSIFY_LIMIT; else process.env.CLASSIFY_LIMIT = savedLimit;
    await rm(root, {recursive: true});
  }
});
test('evaluation fixtures run through a mock model and record measured outcomes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-'));
  try {
    await mkdir(`${root}/catalog`); await mkdir(`${root}/evaluation`);
    await copyFile('evaluation/cases.json', `${root}/evaluation/cases.json`);
    const fixtures = JSON.parse(await readFile('evaluation/cases.json', 'utf8'));
    const fetcher = async (_url: any, options: any) => {
      const docs = JSON.parse(JSON.parse(options.body).messages[1].content);
      return Response.json({choices: [{message: {content: JSON.stringify({decisions: docs.map((doc: any) => ({name: doc.name, relevant: fixtures.cases.find((x: any) => x.name === doc.name).expected, reason: 'Mock for wiring validation only'}))})}}]});
    };
    await evaluate(root, config, fetcher as typeof fetch);
    const report = JSON.parse(await readFile(`${root}/reports/evaluation/latest.json`, 'utf8'));
    assert.equal(report.status, 'passed'); assert.equal(report.metrics.recall, 1);
    const negative = async (_url: any, options: any) => {
      const docs = JSON.parse(JSON.parse(options.body).messages[1].content);
      return Response.json({choices: [{message: {content: JSON.stringify({decisions: docs.map((doc: any) => ({name: doc.name, relevant: false, reason: 'Deliberately incorrect mock'}))})}}]});
    };
    await assert.rejects(evaluate(root, config, negative as typeof fetch), /thresholds/);
    assert.equal(JSON.parse(await readFile(`${root}/reports/evaluation/latest.json`, 'utf8')).status, 'failed');
    await assert.rejects(classifyPending(root, 'backfill', config), /passing evaluation/);
    // The report here is temporary; this mock score is never published as model quality.
  } finally { await rm(root, {recursive: true}); }
});
test('partial configuration cannot silently enable an unbudgeted paid call', () => {
  assert.throws(() => configFromEnv({CLASSIFIER_MODEL: 'model-only'}), /Incomplete/);
  assert.equal(configFromEnv({CLASSIFIER_URL: config.url, CLASSIFIER_API_KEY: 'key', CLASSIFIER_MODEL: config.model, CLASSIFIER_INPUT_USD_PER_MILLION: '1', CLASSIFIER_OUTPUT_USD_PER_MILLION: '2'})?.maxUSD, 0.10);
});
test('parser rejects incomplete batches and budget reservation keeps failed charges', async () => {
  const batch = prepare([draft], config);
  const incomplete = async () => Response.json({choices: [{message: {content: '{"decisions":[]}'}}]});
  await assert.rejects(execute(batch, [draft], config, incomplete as typeof fetch), /decision count/);
  const ledger = {reservedUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0};
  reserve(ledger, batch, config);
  const failure = async () => new Response('', {status: 429});
  await assert.rejects(execute(batch, [draft], config, failure as typeof fetch), /HTTP 429/);
  assert.equal(ledger.reservedUSD, batch.reserveUSD);
});

test('provider failure writes failed evaluation with safe diagnostics and retained reservation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-failure-'));
  try {
    await mkdir(`${root}/catalog`); await mkdir(`${root}/evaluation`);
    await copyFile('evaluation/cases.json', `${root}/evaluation/cases.json`);
    const provider = async () => Response.json({error: {code: 'insufficient_quota', type: 'insufficient_quota', message: `Sensitive provider text ${config.key}`, param: null}}, {status: 429});
    await assert.rejects(evaluate(root, config, provider as typeof fetch), /429.*insufficient_quota/);
    const text = await readFile(`${root}/reports/evaluation/latest.json`, 'utf8');
    const report = JSON.parse(text);
    assert.equal(report.status, 'failed'); assert.equal(report.error.status, 429);
    assert.equal(report.error.code, 'insufficient_quota'); assert.equal(report.completedCount, 0);
    assert.equal(report.ledger.calls, 1); assert.ok(report.ledger.reservedUSD > 0);
    assert.ok(!text.includes(config.key)); assert.ok(!text.includes('Sensitive provider text'));
  } finally { await rm(root, {recursive: true}); }
});
