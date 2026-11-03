import {readFile, writeFile, readdir} from 'node:fs/promises';
import {migrate, encode} from './state.ts';
const input = JSON.parse(await readFile('catalog/state.json', 'utf8'));
if (input.version !== 2) {
  const {state, related} = migrate(input);
  await writeFile('catalog/related.json', JSON.stringify(related, null, 2) + '\n');
  await writeFile('catalog/state.json', encode(state));
}
for (const name of await readdir('reports/daily')) {
  if (!name.endsWith('.json')) continue;
  const path = `reports/daily/${name}`;
  const old = JSON.parse(await readFile(path, 'utf8'));
  if (old.version === 2) continue;
  const rows = old.changed;
  if (!Array.isArray(rows)) throw new Error(`Unknown report: ${name}`);
  const summary = {version: 2, started: old.started, full: old.full, changedCount: rows.length,
    relevant: rows.filter(x => x.decision.relevant === true).map(x => x.document.name),
    pendingCount: rows.filter(x => x.decision.relevant === null).length};
  await writeFile(path, JSON.stringify(summary, null, 2) + '\n');
}
