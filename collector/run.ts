import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {documents, overlap, revisionKey, classify} from './core.ts';
import type {Document, Decision} from './core.ts';
type Entry = {document: Document; decision: Decision; observedAt: string; classifiedAt?: string};
type State = {lastSuccess?: string; entries: Record<string, Entry>};
await mkdir('catalog', {recursive: true});
await mkdir('reports/daily', {recursive: true});
let state: State;
try { state = JSON.parse(await readFile('catalog/state.json', 'utf8')); }
catch (error: any) { if (error.code !== 'ENOENT') throw error; state = {entries: {}}; }
const started = new Date().toISOString();
// Weekly full reconciliation also retries older uncertain classifications.
const full = process.env.FULL_SCAN === 'true' || new Date().getUTCDay() === 0;
const changed: string[] = [];
for (const type of ['draft', 'rfc'] as const) {
for await (const doc of documents(full ? undefined : overlap(state.lastSuccess), fetch, type)) {
  const key = revisionKey(doc);
  const previous = state.entries[key];
  if (previous && previous.document.time === doc.time && previous.decision.relevant !== null) continue;
  const decision = previous?.decision ?? {relevant: null, reason: 'Awaiting semantic review'};
  state.entries[key] = {document: doc, decision, observedAt: started};
  changed.push(key);
}
}
// Bound model costs; older pending documents remain eligible every day.
const budget = Number(process.env.CLASSIFY_LIMIT ?? 30);
if (!Number.isInteger(budget) || budget < 0) throw new Error('Invalid CLASSIFY_LIMIT');
if (process.env.CLASSIFIER_URL && process.env.CLASSIFIER_API_KEY && process.env.CLASSIFIER_MODEL) {
  let count = 0;
  for (const [key, entry] of Object.entries(state.entries).sort((a, b) => (a[1].classifiedAt ?? '').localeCompare(b[1].classifiedAt ?? ''))) {
    if (entry.decision.relevant !== null || count >= budget) continue;
    entry.decision = await classify(entry.document, {url: process.env.CLASSIFIER_URL, key: process.env.CLASSIFIER_API_KEY, model: process.env.CLASSIFIER_MODEL});
    entry.classifiedAt = started;
    if (!changed.includes(key)) changed.push(key);
    count++;
  }
}
// Commit checkpoint only after every page and classification succeeded.
state.lastSuccess = started;
await writeFile('catalog/state.json.tmp', JSON.stringify(state, null, 2) + '\n');
await rename('catalog/state.json.tmp', 'catalog/state.json');
const report = {started, full, changed: changed.map(key => ({key, ...state.entries[key]}))};
await writeFile(`reports/daily/${started.slice(0, 10)}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`Collected ${changed.length} new, changed or review-pending revisions`);
