import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {documents, overlap} from './core.ts';
import {empty, migrate, encode, ingest} from './state.ts';
import type {State, Related} from './state.ts';
export async function collect(root = '.', source = documents, fetcher = fetch): Promise<void> {
  const read = async (path: string, fallback: any) => {
    try { return JSON.parse(await readFile(`${root}/${path}`, 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; return fallback; }
  };
  const input = await read('catalog/state.json', empty());
  const migrated = migrate(input);
  const state: State = migrated.state;
  const related: Record<string, Related> = input.version === 2 ? await read('catalog/related.json', {}) : migrated.related;
  const original = encode(state);
  const started = new Date().toISOString();
  const full = process.env.FULL_SCAN === 'true' || new Date().getUTCDay() === 0;
  const changed = new Set<string>();
  // RFC list is reconciled in full: do not assume publication order follows numbers.
  for (const type of ['draft', 'rfc'] as const) {
    for await (const doc of source(type === 'rfc' || full ? undefined : overlap(state.lastSuccess), fetcher, type)) {
      if (ingest(state, doc)) { changed.add(doc.name); delete related[doc.name]; }
    }
  }
  if (original === encode(state) && input.version === 2) {
    console.log('No catalog changes; no report or checkpoint rewrite'); return;
  }
  state.lastSuccess = started;
  await mkdir(`${root}/catalog`, {recursive: true});
  await mkdir(`${root}/reports/daily`, {recursive: true});
  const atomic = async (path: string, data: string) => { await writeFile(`${root}/${path}.tmp`, data); await rename(`${root}/${path}.tmp`, `${root}/${path}`); };
  // All remote work completes before writing a successful checkpoint.
  await atomic('catalog/related.json', JSON.stringify(related, null, 2) + '\n');
  const relevant = [...changed].filter(name => state.index[name][2] === true);
  const report = {version: 2, started, full, changedCount: changed.size, relevant, pendingCount: Object.values(state.index).filter(row => row[2] === null).length};
  await atomic(`reports/daily/${started.replace(/[:.]/g, '-')}.json`, JSON.stringify(report, null, 2) + '\n');
  await atomic('catalog/state.json', encode(state));
  console.log(`Updated ${changed.size} compact index rows`);
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await collect();
