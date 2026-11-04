import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {getJson, API} from './core.ts';
import type {Document} from './core.ts';
import {encode, ingest, setDecision} from './state.ts';
import type {State, Related} from './state.ts';
import {configFromEnv, PROMPT_VERSION, prepare, reserve, execute, failureDetails} from './model.ts';
import {withSelectedModel} from './select-model.ts';
import {EVALUATION_VERSION, ensureEvaluation} from './evaluate.ts';
import type {Ledger, Config} from './model.ts';
export function queue(state: State, mode: string, now = Date.now()): string[] {
  return Object.entries(state.index).filter(([, row]) => row[2] === null && (!row[4] || Date.parse(row[4]) < now - 7 * 86400000))
    .sort((a, b) => {
      if (mode === 'daily') { const fresh = (b[1][5] ?? '').localeCompare(a[1][5] ?? ''); if (fresh) return fresh; }
      return (a[1][4] ?? '').localeCompare(b[1][4] ?? '') || a[0].localeCompare(b[0]);
    }).map(([name]) => name);
}
export async function classifyPending(root = '.', mode = 'daily', config: Config | undefined = configFromEnv(), fetcher = fetch): Promise<void> {
  if (!['daily', 'backfill'].includes(mode)) throw new Error('Mode must be daily or backfill');
  if (!config) { console.log('Classifier not configured; no paid requests made'); return; }
  const evaluation = JSON.parse(await readFile(`${root}/reports/evaluation/latest.json`, 'utf8').catch(() => { throw new Error('Run model evaluation before classification'); }));
  if (evaluation.status !== 'passed' || evaluation.model !== config.model || evaluation.url !== config.url || evaluation.promptVersion !== PROMPT_VERSION || evaluation.fixtureVersion !== EVALUATION_VERSION) throw new Error('Run a passing evaluation for this model, endpoint and prompt first');
  const limit = Number(process.env.CLASSIFY_LIMIT || (mode === 'backfill' ? 500 : 30));
  if (!Number.isInteger(limit) || limit < 0 || limit > 5000) throw new Error('CLASSIFY_LIMIT must be 0..5000');
  const state: State = JSON.parse(await readFile(`${root}/catalog/state.json`, 'utf8'));
  if (state.version !== 2) throw new Error('Migrate catalog first');
  const related: Record<string, Related> = JSON.parse(await readFile(`${root}/catalog/related.json`, 'utf8'));
  let ledger: Ledger;
  try { ledger = JSON.parse(await readFile(`${root}/catalog/classification-budget.json`, 'utf8')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; ledger = {reservedUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0}; }
  if (!Number.isFinite(ledger.reservedUSD) || ledger.reservedUSD < 0) throw new Error('Invalid budget ledger');
  const names = queue(state, mode).slice(0, limit);
  const at = new Date().toISOString();
  await mkdir(`${root}/reports/classification`, {recursive: true});
  const save = async (path: string, value: string) => { await writeFile(`${root}/${path}.tmp`, value); await rename(`${root}/${path}.tmp`, `${root}/${path}`); };
  const completed: string[] = [];
  let status = 'completed';
  let failure: Record<string, unknown> | undefined;
  try {
    for (let offset = 0; offset < names.length; offset += 10) {
      if (ledger.reservedUSD >= config.maxUSD) { status = 'budget_exhausted'; break; }
      const docs: Document[] = [];
      for (const name of names.slice(offset, offset + 10)) {
        const page = await getJson(`${API}/api/v1/doc/document/?name=${encodeURIComponent(name)}`, fetcher);
        const doc = page.objects?.find((d: Document) => d.name === name);
        if (!doc || typeof doc.rev !== 'string' || typeof doc.time !== 'string') throw new Error(`Invalid metadata for ${name}`);
        docs.push(doc);
      }
      // Shrink the last batch to use a small budget without exceeding its bound.
      let batch = prepare(docs, config);
      while (docs.length && ledger.reservedUSD + batch.reserveUSD > config.maxUSD) { docs.pop(); if (docs.length) batch = prepare(docs, config); }
      if (!docs.length || !reserve(ledger, batch, config)) { status = 'budget_exhausted'; break; }
      // Persist reservation BEFORE the request. Crashes or errors do not refund it.
      await save('catalog/classification-budget.json', JSON.stringify(ledger, null, 2) + '\n');
      const result = await execute(batch, docs, config, fetcher);
      ledger.inputTokens += result.inputTokens ?? 0; ledger.outputTokens += result.outputTokens ?? 0;
      if (result.inputTokens !== null && result.outputTokens !== null) ledger.usageReportedCalls = (ledger.usageReportedCalls ?? 0) + 1;
      for (const doc of docs) {
        ingest(state, doc);
        setDecision(state, related, doc, result.decisions.get(doc.name)!, `${PROMPT_VERSION}:${config.model}`, at);
        completed.push(doc.name);
      }
      await save('catalog/related.json', JSON.stringify(related, null, 2) + '\n');
      await save('catalog/state.json', encode(state));
      await save('catalog/classification-budget.json', JSON.stringify(ledger, null, 2) + '\n');
      if (docs.length < Math.min(10, names.length - offset)) { status = 'budget_exhausted'; break; }
    }
  } catch (error) { status = 'failed'; failure = failureDetails(error); throw error; }
  finally {
    if (completed.length || status !== 'completed') await save(`reports/classification/${at.replace(/[:.]/g, '-')}.json`, JSON.stringify({at, mode, status, model: config.model, inputRate: config.inputRate, outputRate: config.outputRate, maxUSD: config.maxUSD, promptVersion: PROMPT_VERSION, completed, error: failure, pending: Object.values(state.index).filter(row => row[2] === null).length, ...ledger}, null, 2) + '\n');
    console.log(`Classification ${status}: ${completed.length} documents; cumulative reserved USD ${ledger.reservedUSD.toFixed(6)}`);
  }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await withSelectedModel(async config => {
    if (config) await ensureEvaluation('.', config);
    await classifyPending('.', process.env.CLASSIFY_MODE ?? 'daily', config);
  });
}
