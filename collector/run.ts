import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {documents, overlap, revisionKey, classify} from './core.ts';
import type {Document, Decision} from './core.ts';
type Entry = {document: Document; decision: Decision; observedAt: string};
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
  const decision = await classify(doc, {url: process.env.CLASSIFIER_URL, key: process.env.CLASSIFIER_API_KEY, model: process.env.CLASSIFIER_MODEL});
  state.entries[key] = {document: doc, decision, observedAt: started};
  changed.push(key);
}
}
// Commit checkpoint only after every page and classification succeeded.
state.lastSuccess = started;
await writeFile('catalog/state.json.tmp', JSON.stringify(state, null, 2) + '\n');
await rename('catalog/state.json.tmp', 'catalog/state.json');
const report = {started, full, changed: changed.map(key => ({key, ...state.entries[key]}))};
await writeFile(`reports/daily/${started.slice(0, 10)}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`Collected ${changed.length} new, changed or review-pending revisions`);
