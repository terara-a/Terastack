import {resolveConfig} from './select-model.ts';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {prepare, reserve, execute, configFromEnv, PROMPT_VERSION, failureDetails} from './model.ts';
import type {Config, Ledger} from './model.ts';
import type {Decision, Document} from './core.ts';
export const EVALUATION_VERSION = 'authz-eval-v1';
export function metrics(cases: {name: string; expected: boolean}[], decisions: Map<string, Decision>) {
  let tp = 0, fp = 0, fn = 0, tn = 0, uncertain = 0;
  for (const item of cases) {
    const decision = decisions.get(item.name)?.relevant;
    if (decision === null || decision === undefined) uncertain++;
    if (item.expected) { if (decision === true) tp++; else fn++; }
    else if (decision === true) fp++; else if (decision === false) tn++;
  }
  return {tp, fp, fn, tn, uncertain, recall: tp / (tp + fn || 1), precision: tp / (tp + fp || 1)};
}
export async function ensureEvaluation(root: string, config: Config, fetcher = fetch): Promise<void> {
  let previous: any;
  try { previous = JSON.parse(await readFile(`${root}/reports/evaluation/latest.json`, 'utf8')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.status === 'passed' && previous.model === config.model && previous.url === config.url && previous.promptVersion === PROMPT_VERSION && previous.fixtureVersion === EVALUATION_VERSION) return;
  await evaluate(root, config, fetcher);
}
export async function evaluate(root = '.', config: Config | undefined = configFromEnv(), fetcher = fetch): Promise<void> {
  const fixture = JSON.parse(await readFile(`${root}/evaluation/cases.json`, 'utf8'));
  if (fixture.version !== EVALUATION_VERSION || fixture.cases.length < 10 || new Set(fixture.cases.map((x: any) => x.name)).size !== fixture.cases.length || fixture.cases.some((x: any) => typeof x.expected !== 'boolean' || typeof x.abstract !== 'string')) throw new Error('Invalid evaluation fixtures');
  if (!config) { console.log(`Validated ${fixture.cases.length} fixtures; model evaluation NOT RUN (no configuration). No accuracy or cost measured.`); return; }
  await mkdir(`${root}/reports/evaluation`, {recursive: true});
  const save = async (path: string, value: any) => { await writeFile(`${root}/${path}.tmp`, JSON.stringify(value, null, 2) + '\n'); await rename(`${root}/${path}.tmp`, `${root}/${path}`); };
  let ledger: Ledger;
  try { ledger = JSON.parse(await readFile(`${root}/catalog/classification-budget.json`, 'utf8')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; ledger = {reservedUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0}; }
  if (!Number.isFinite(ledger.reservedUSD) || ledger.reservedUSD < 0) throw new Error('Invalid budget ledger');
  await save('reports/evaluation/latest.json', {status: 'running', model: config.model, url: config.url, promptVersion: PROMPT_VERSION, fixtureVersion: EVALUATION_VERSION});
  const reservedBefore = ledger.reservedUSD;
  const all = new Map<string, Decision>();
  const started = Date.now();
  try {
    for (let i = 0; i < fixture.cases.length; i += 10) {
      const docs: Document[] = fixture.cases.slice(i, i + 10).map(({expected, ...d}: any) => ({...d, rev: '', time: '', resource_uri: ''}));
      const batch = prepare(docs, config);
      if (!reserve(ledger, batch, config)) throw new Error('Evaluation budget exhausted; raise the explicit cumulative cap to continue');
      await save('catalog/classification-budget.json', ledger);
      const result = await execute(batch, docs, config, fetcher);
      ledger.inputTokens += result.inputTokens ?? 0; ledger.outputTokens += result.outputTokens ?? 0;
      if (result.inputTokens !== null && result.outputTokens !== null) ledger.usageReportedCalls = (ledger.usageReportedCalls ?? 0) + 1;
      await save('catalog/classification-budget.json', ledger);
      for (const [name, decision] of result.decisions) all.set(name, decision);
    }
  } catch (error) {
    await save('reports/evaluation/latest.json', {
      at: new Date().toISOString(), status: 'failed', model: config.model, url: config.url,
      promptVersion: PROMPT_VERSION, fixtureVersion: fixture.version,
      durationMs: Date.now() - started, completedCount: all.size,
      error: failureDetails(error), ledger
    });
    throw error;
  }
  const measured = metrics(fixture.cases, all);
  const passed = measured.recall >= 0.9 && measured.precision >= 0.8 && measured.uncertain === 0;
  const report = {at: new Date().toISOString(), status: passed ? 'passed' : 'failed', fixtureVersion: fixture.version, promptVersion: PROMPT_VERSION, model: config.model, url: config.url, inputRate: config.inputRate, outputRate: config.outputRate, maxUSD: config.maxUSD, durationMs: Date.now() - started, reservedUSDForEvaluation: ledger.reservedUSD - reservedBefore, estimatedReservationPerDocumentUSD: (ledger.reservedUSD - reservedBefore) / fixture.cases.length, metrics: measured, ledger, decisions: Object.fromEntries(all)};
  await save('reports/evaluation/latest.json', report);
  console.log(JSON.stringify({status: report.status, ...measured, durationMs: report.durationMs}));
  if (!passed) throw new Error('Evaluation thresholds not met; review false negatives before bulk classification');
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await evaluate('.', await resolveConfig());
