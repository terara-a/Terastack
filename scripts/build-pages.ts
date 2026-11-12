import {readFile, readdir, mkdir, copyFile, writeFile, cp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {validateOpenIDReviews, openIDReviewState} from './reviews.ts';
export function publicData(state: any, reports: any[], reviewed: any = {}, candidates: any = {}, semantic: any = null, openid: any = null) {
  if (state.version !== 2 || !state.index) throw new Error('Expected compact catalog v2');
  validateOpenIDReviews(reviewed);
  const counts = {total: 0, rfc: 0, draft: 0, relevant: 0, unrelated: 0, pending: 0};
  for (const name of Object.keys(state.index)) {
    counts.total++; if (/^rfc\d+$/.test(name)) counts.rfc++; else counts.draft++;
  }
  const merged = new Map<string, {name:string;type:string;rev:string;title:string;reason:string;url:string;status:string}>();
  let excluded = 0;
  for (const [name, doc] of Object.entries(candidates) as [string, any][]) {
    const row = state.index[name];
    if (!/^(rfc\d+|draft-[a-z0-9-]+)$/.test(name) || !row || (!name.startsWith('rfc') && (doc.rev !== row[0] || doc.time !== row[1]))) continue;
    merged.set(name, {name, type:name.startsWith('rfc')?'RFC':'Draft',rev:String(doc.rev ?? ''),title:String(doc.title ?? ''),reason:String(doc.reason ?? ''),url:`https://datatracker.ietf.org/doc/${name}/`,status:'candidate'});
  }
  for (const [name, doc] of Object.entries(reviewed) as [string, any][]) {
    if (!/^(rfc\d+|draft-[a-z0-9-]+)$/.test(name) || !state.index[name]) continue;
    if (!name.startsWith('rfc') && doc.rev !== state.index[name][0]) continue;
    if (doc.status === 'excluded') { merged.delete(name); excluded++; continue; }
    if (doc.status !== 'confirmed') continue;
    merged.set(name, {name,type:name.startsWith('rfc')?'RFC':'Draft',rev:String(doc.rev ?? ''),title:String(doc.title ?? ''),reason:String(doc.reason ?? ''),url:`https://datatracker.ietf.org/doc/${name}/`,status:'confirmed'});
  }
  let openidCount = 0;
  const openidDocuments = Object.entries(openid?.documents ?? {}).flatMap(([name, doc]: [string, any]) => {
    if (!doc.listed) return [];
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || doc.url !== `https://openid.net/specs/${name}.html` || typeof doc.title !== 'string') throw new Error('Invalid OpenID specification');
    openidCount++;
    const decision = reviewed[`openid:${name}`];
    const status = openIDReviewState(decision,doc);
    if (status === 'excluded') { excluded++; return []; }
    const reason = status === 'confirmed' ? decision.reason : status === 'needs_review'
      ? `以前の確認理由：${decision.reason}` : '公式仕様一覧への掲載。関連性・内容は未確認です。';
    return [{name,type:'OpenID',source:'OpenID Foundation',rev:String(doc.revision ?? ''),title:status === 'confirmed' ? decision.title : doc.title,reason,url:doc.url,status,stage:String(doc.stage ?? 'Other'),checkedAt:doc.checkedAt ?? null,
      ...(decision ? {reviewedAt:decision.reviewedAt} : {}),
      ...(status === 'needs_review' ? {reviewNotice:'対象版または本文が確認時と一致しません。原文を再確認してください。'} : {})}];
  });
  const documents = [...merged.values()].map(doc=>({...doc,source:'IETF',stage:''})).concat(openidDocuments).sort((a,b) => ({confirmed:0,needs_review:1,listed:2,candidate:3}[a.status] - {confirmed:0,needs_review:1,listed:2,candidate:3}[b.status]) || a.name.localeCompare(b.name));
  counts.total += openidCount;
  const review = {listed:documents.filter(d=>d.status==='listed').length,needsReview:documents.filter(d=>d.status==='needs_review').length,confirmed:documents.filter(d=>d.status==='confirmed').length,candidates:documents.filter(d=>d.status==='candidate').length,screened:semantic?.screened ?? 0,unreviewed:counts.total-excluded-documents.filter(d=>d.status==='confirmed').length};
  counts.relevant = documents.length; counts.unrelated = excluded; counts.pending = review.unreviewed;
  const daily = reports.map(report => ({at: report.started, changed: report.changedCount ?? 0}))
    .filter(report => typeof report.at === 'string' && Number.isFinite(Date.parse(report.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  return {lastCollection: state.lastSuccess ?? null, openidCollection:openid?.lastSuccess ?? null, openidCount, counts, documents, daily, review};
}
export async function buildPages(root = '.', output = 'dist') {
  const read = async (path: string, fallback: any) => {
    try { return JSON.parse(await readFile(join(root, path), 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; return fallback; }
  };
  const state = await read('catalog/state.json', {version: 2, index: {}});
  let names: string[];
  try { names = await readdir(join(root, 'reports/daily')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; names = []; }
  const reports = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(`reports/daily/${name}`, null)));
  const data = publicData(state, reports, await read('catalog/reviewed.json', {}), await read('catalog/candidates.json', {}), await read('reports/semantic/progress.json', null), await read('catalog/openid.json', null));
  const target = join(root, output); await mkdir(target, {recursive: true});
  for (const file of ['index.html', 'style.css', 'app.js']) await copyFile(join(root, 'site', file), join(target, file));
  await rm(join(target,'samples'),{recursive:true,force:true});
  await cp(join(root,'site/samples'),join(target,'samples'),{recursive:true});
  await writeFile(join(target, 'data.json'), JSON.stringify(data) + '\n');
  await writeFile(join(target, '.nojekyll'), '');
  console.log(`Built Pages: ${data.counts.total} indexed, ${data.documents.length} relevant; public JSON ${Buffer.byteLength(JSON.stringify(data))} bytes`);
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await buildPages();
