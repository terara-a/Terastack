import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {buildPages} from './build-pages.ts';
const catalogFiles = new Set(['catalog/state.json','catalog/candidates.json','catalog/semantic-index.json']);
export function allowedPath(path: string): boolean {
  return catalogFiles.has(path) || /^reports\/daily\/[0-9TZ.:-]+\.json$/.test(path) || /^reports\/semantic\/(evaluation|progress)\.json$/.test(path);
}
export function eligible(pr: any, repository: string): void {
  if (pr.state !== 'open' || pr.draft || pr.base?.ref !== 'main' || pr.head?.ref !== 'standards/daily' || pr.head?.repo?.full_name !== repository || pr.user?.login !== 'github-actions[bot]' || pr.user?.type !== 'Bot') throw new Error('Only same-repository, bot-generated standards/daily data PRs are eligible');
  for (const sha of [pr.base.sha,pr.head.sha]) if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit SHA');
}
export function validateData(path: string, value: any): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object: ${path}`);
  if (value.status === 'failed' || value.status === 'running') throw new Error(`Unsuccessful report: ${path}`);
  if (path === 'catalog/state.json') {
    if (value.version !== 2 || !value.index || typeof value.index !== 'object') throw new Error('Invalid compact catalog');
    for (const row of Object.values(value.index) as any[]) if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string' || ![true,false,null].includes(row[2])) throw new Error('Invalid index row');
  }
  if (path === 'catalog/semantic-index.json') {
    if (typeof value.signature !== 'string' || !value.entries) throw new Error('Invalid semantic index');
    for (const row of Object.values(value.entries) as any[]) if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1])) throw new Error('Invalid semantic score');
  }
  if (path === 'catalog/candidates.json') {
    for (const doc of Object.values(value) as any[]) if (!doc || typeof doc.title !== 'string' || typeof doc.rev !== 'string' || typeof doc.reason !== 'string') throw new Error(`Invalid document: ${path}`);
  }
  if (path === 'reports/semantic/evaluation.json' && (value.status !== 'passed' || value.metrics?.recall < .9 || value.metrics?.precision < .5 || !Number.isFinite(value.metrics?.recall) || !Number.isFinite(value.metrics?.precision))) throw new Error('Semantic evaluation not passed');
}
const git = (...args: string[]) => execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
export async function validateSnapshot(pr: any, repository: string): Promise<string[]> {
  eligible(pr,repository);
  git('fetch','origin',pr.base.sha,pr.head.sha);
  const base = git('merge-base',pr.base.sha,pr.head.sha).trim();
  const changes = git('diff','--name-status','--no-renames','-z',base,pr.head.sha).split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i=0;i<changes.length;i+=2) {
    const [status,path] = [changes[i],changes[i+1]];
    if (!['A','M'].includes(status) || !allowedPath(path)) throw new Error(`Manual review required: ${path}`);
    const mode = git('ls-tree',pr.head.sha,'--',path).split(' ')[0];
    if (mode !== '100644') throw new Error(`Non-regular data file: ${path}`);
    validateData(path,JSON.parse(git('show',`${pr.head.sha}:${path}`)));
    paths.push(path);
  }
  if (!paths.length) throw new Error('No data changes');
  const root = await mkdtemp(join(tmpdir(),'catalog-validation-'));
  try {
    // Build with trusted current code, never run scripts from the PR head.
    await cp('site',join(root,'site'),{recursive:true});
    await mkdir(join(root,'src'),{recursive:true});
    await cp('src/worker.ts',join(root,'src/worker.ts'));
    await cp('examples',join(root,'examples'),{recursive:true});
    const files = git('ls-tree','-r','--name-only',pr.head.sha,'--','catalog','reports').trim().split('\n');
    for (const file of files) {
      if (!file.endsWith('.json') || !(file.startsWith('catalog/') || file.startsWith('reports/'))) continue;
      await mkdir(dirname(join(root,file)),{recursive:true});
      await writeFile(join(root,file),git('show',`${pr.head.sha}:${file}`));
    }
    await buildPages(root);
  } finally { await rm(root,{recursive:true}); }
  return paths;
}
export async function mergeCatalog(repository: string, number: number, token: string, checkOnly = false, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isInteger(number) || number < 1 || !token) throw new Error('Set repository, PR number and token');
  const api = async (path: string, method='GET', body?: any) => {
    const response=await fetcher(`https://api.github.com/repos/${repository}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}; no protection bypass is attempted`);
    return response.status === 204 ? null : response.json();
  };
  const pr=await api(`pulls/${number}`);
  const paths=await validateSnapshot(pr,repository);
  console.log(`Validated ${paths.length} data files at ${pr.head.sha}`);
  if (checkOnly) return;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== repository) throw new Error('Automatic merge only runs from main in the owning repository');
  const result=await api(`pulls/${number}/merge`,'PUT',{sha:pr.head.sha,merge_method:'squash'});
  if (!result?.merged) throw new Error('GitHub did not merge the PR');
  console.log(`Merged catalog PR #${number}`);
  // GITHUB_TOKEN merges do not trigger push workflows; dispatch Pages explicitly.
  await api('actions/workflows/pages.yml/dispatches','POST',{ref:'main'});
  console.log('Requested Pages deployment');
}
if (import.meta.url === new URL(process.argv[1],'file:').href) await mergeCatalog(process.env.GITHUB_REPOSITORY ?? '',Number(process.env.CATALOG_PR_NUMBER),process.env.GH_TOKEN ?? '',process.argv.includes('--check-only'));
