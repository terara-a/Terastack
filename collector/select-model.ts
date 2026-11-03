import {appendFile} from 'node:fs/promises';
import {checkModels} from '../scripts/check-models.ts';
import {configFromEnv} from './model.ts';
import type {Config} from './model.ts';
export type Profile = {id: string; inputRate: number; outputRate: number};
// Reservation estimates, not prices obtained from GET /models. Override when rates change.
export const DEFAULT_PROFILES: Profile[] = [
  {id: 'gpt-4.1-nano', inputRate: 0.10, outputRate: 0.40},
  {id: 'gpt-4o-mini', inputRate: 0.15, outputRate: 0.60},
  {id: 'gpt-4.1-mini', inputRate: 0.40, outputRate: 1.60}
];
export function chooseModel(models: string[], profiles = DEFAULT_PROFILES): Profile {
  if (!Array.isArray(profiles) || profiles.some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.id) || ![p.inputRate, p.outputRate].every(n => Number.isFinite(n) && n > 0))) throw new Error('Invalid automatic model profiles');
  const ranked = [...profiles].sort((a, b) => (a.inputRate + a.outputRate) - (b.inputRate + b.outputRate) || a.id.localeCompare(b.id));
  for (const profile of ranked) {
    if (models.includes(profile.id)) return profile;
    const dated = models.filter(id => id.startsWith(`${profile.id}-`) && /^\d{4}-\d{2}-\d{2}$/.test(id.slice(profile.id.length + 1))).sort().reverse()[0];
    if (dated) return {...profile, id: dated};
  }
  throw new Error('No supported low-cost model is listed; run models mode and add a compatible priced profile');
}
export async function resolveConfig(env = process.env, fetcher = fetch): Promise<Config | undefined> {
  if (env.CLASSIFIER_SELECTION === 'fixed') return configFromEnv(env);
  if (!env.CLASSIFIER_URL && !env.CLASSIFIER_API_KEY) return undefined;
  if (!env.CLASSIFIER_URL || !env.CLASSIFIER_API_KEY) throw new Error('Set CLASSIFIER_URL and CLASSIFIER_API_KEY');
  const profiles = env.CLASSIFIER_MODEL_PROFILES ? JSON.parse(env.CLASSIFIER_MODEL_PROFILES) : DEFAULT_PROFILES;
  const listing = await checkModels(env.CLASSIFIER_URL, env.CLASSIFIER_API_KEY, '', fetcher);
  const selected = chooseModel(listing.models, profiles);
  const config = configFromEnv({...env, CLASSIFIER_MODEL: selected.id, CLASSIFIER_INPUT_USD_PER_MILLION: String(selected.inputRate), CLASSIFIER_OUTPUT_USD_PER_MILLION: String(selected.outputRate)});
  console.log(`Automatically selected ${selected.id}; reservation rates: input=${selected.inputRate}, output=${selected.outputRate} USD per million tokens`);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `## Selected model\n\nModel: \`${selected.id}\`\n\nReservation rates: input ${selected.inputRate}, output ${selected.outputRate} USD / million tokens.\n`);
  return config;
}
