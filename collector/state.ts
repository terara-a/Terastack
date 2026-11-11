import type {Document} from './core.ts';
// Slots 2–4 are retained for compact-v2 compatibility; CPU screening uses a separate index.
// Latest revision only. Empty RFC revision/time avoid retaining immutable metadata.
export type Row = [rev: string, time: string, reservedDecision: boolean | null, reservedClassifier?: string, reservedAttempt?: string, discoveredAt?: string];
export type State = {version: 2; lastSuccess?: string; index: Record<string, Row>};
export function empty(): State { return {version: 2, index: {}}; }
export function ingest(state: State, doc: Document): boolean {
  const rfc = /^rfc\d+$/.test(doc.name);
  const old = state.index[doc.name];
  if (old && (rfc || (old[0] === doc.rev && old[1] === doc.time))) return false;
  state.index[doc.name] = [rfc ? '' : doc.rev, rfc ? '' : doc.time, null, '', '', new Date().toISOString()];
  return true;
}
export function encode(state: State): string {
  // One compact row per document keeps diffs readable without verbose metadata.
  const rows = Object.entries(state.index).sort(([a], [b]) => a.localeCompare(b));
  return `{\n"version":2,\n"lastSuccess":${JSON.stringify(state.lastSuccess ?? null)},\n"index":{\n${rows.map(([name, row]) => `${JSON.stringify(name)}:${JSON.stringify(row)}`).join(',\n')}\n}\n}\n`;
}
