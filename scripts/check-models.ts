import {appendFile} from 'node:fs/promises';
import {ClassifierError, failureDetails} from '../collector/model.ts';
export function modelsURL(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/\/chat\/completions\/?$/.test(url.pathname)) throw new Error('Expected an HTTPS Chat Completions URL without credentials or query parameters');
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/models');
  return url.href;
}
export async function checkModels(endpoint: string, key: string, configured = '', fetcher = fetch) {
  if (!key) throw new Error('CLASSIFIER_API_KEY is not configured');
  const response = await fetcher(modelsURL(endpoint), {headers: {'Authorization': `Bearer ${key}`}, signal: AbortSignal.timeout(30000)});
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as any;
    throw new ClassifierError(response.status, body?.error, key);
  }
  const data = await response.json() as any;
  if (!Array.isArray(data.data) || data.data.some((item: any) => typeof item?.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(item.id) || item.id.includes(key))) throw new Error('Invalid model listing response');
  const models = [...new Set<string>(data.data.map((item: any) => item.id))].sort();
  // Listing access does not establish inference permissions or billing readiness.
  return {configuredModel: configured, listed: configured ? models.includes(configured) : null, models};
}
export async function main() {
  try {
    const result = await checkModels(process.env.CLASSIFIER_URL ?? '', process.env.CLASSIFIER_API_KEY ?? '', process.env.CLASSIFIER_MODEL ?? '');
    const text = JSON.stringify(result, null, 2);
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Available models\n\nThis is a listing check; no inference request is sent.\n\n\`\`\`json\n${text}\n\`\`\`\n`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Model listing::${JSON.stringify(result)}`);
    if (result.listed === false) process.exitCode = 1;
  } catch (error) {
    const safe = failureDetails(error);
    if (safe.kind === 'request_or_response_error') safe.message = 'Model listing could not complete; verify CLASSIFIER_URL and API key configuration';
    console.error(JSON.stringify(safe));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Model listing failed\n\n\`\`\`json\n${JSON.stringify(safe, null, 2)}\n\`\`\`\nCheck the Models Read permission and configured endpoint.\n`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=Model listing failed::${JSON.stringify(safe)}`);
    process.exitCode = 1;
  }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await main();
