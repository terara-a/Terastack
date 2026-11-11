import {readFile, readdir, mkdir, copyFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export function publicData(state: any, related: any, reports: any[], evaluation: any = null) {
  if (state.version !== 2 || !state.index) throw new Error('Expected compact catalog v2');
  const counts = {total: 0, rfc: 0, draft: 0, relevant: 0, unrelated: 0, pending: 0};
  for (const [name, row] of Object.entries(state.index) as [string, any][]) {
    counts.total++; if (/^rfc\d+$/.test(name)) counts.rfc++; else counts.draft++;
    if (row[2] === true) counts.relevant++; else if (row[2] === false) counts.unrelated++; else counts.pending++;
  }
  const documents = Object.entries(related).filter(([name]) => /^(rfc\d+|draft-[a-z0-9-]+)$/.test(name) && state.index[name]?.[2] === true)
    .map(([name, doc]: [string, any]) => ({name, type: name.startsWith('rfc') ? 'RFC' : 'Draft', rev: String(doc.rev ?? ''), title: String(doc.title ?? ''), reason: String(doc.reason ?? ''), url: `https://datatracker.ietf.org/doc/${name}/`}));
  const daily = reports.map(report => ({at: report.started, changed: report.changedCount ?? 0, relevant: report.relevant?.length ?? 0, pending: report.pendingCount ?? null}))
    .filter(report => typeof report.at === 'string' && Number.isFinite(Date.parse(report.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  return {lastCollection: state.lastSuccess ?? null, counts, documents, daily, evaluationStatus: ['passed', 'failed', 'running'].includes(evaluation?.status) ? evaluation.status : 'not_run'};
}
export async function buildPages(root = '.', output = 'dist') {
  const read = async (path: string, fallback: any) => {
    try { return JSON.parse(await readFile(join(root, path), 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; return fallback; }
  };
  const state = await read('catalog/state.json', {version: 2, index: {}});
  const related = await read('catalog/related.json', {});
  let names: string[];
  try { names = await readdir(join(root, 'reports/daily')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; names = []; }
  const reports = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(`reports/daily/${name}`, null)));
  const data = publicData(state, related, reports, await read('reports/evaluation/latest.json', null));
  const target = join(root, output); await mkdir(target, {recursive: true});
  for (const file of ['index.html', 'style.css', 'app.js']) await copyFile(join(root, 'site', file), join(target, file));
  await writeFile(join(target, 'data.json'), JSON.stringify(data) + '\n');
  await writeFile(join(target, '.nojekyll'), '');
  console.log(`Built Pages: ${data.counts.total} indexed, ${data.documents.length} relevant; public JSON ${Buffer.byteLength(JSON.stringify(data))} bytes`);
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await buildPages();
