import type {Document, Decision} from './core.ts';
// Latest revision only. Empty RFC revision/time avoid retaining immutable metadata.
export type Row = [rev: string, time: string, relevant: boolean | null, classifier?: string, attemptedAt?: string, discoveredAt?: string];
export type Related = {rev: string; title: string; url: string; reason: string};
export type State = {version: 2; lastSuccess?: string; index: Record<string, Row>};
export function empty(): State { return {version: 2, index: {}}; }
export function ingest(state: State, doc: Document): boolean {
  const rfc = /^rfc\d+$/.test(doc.name);
  const old = state.index[doc.name];
  if (old && (rfc || (old[0] === doc.rev && old[1] === doc.time))) return false;
  state.index[doc.name] = [rfc ? '' : doc.rev, rfc ? '' : doc.time, null, '', '', new Date().toISOString()];
  return true;
}
export function setDecision(state: State, related: Record<string, Related>, doc: Document, decision: Decision, classifier: string, at: string): void {
  const row = state.index[doc.name];
  row[2] = decision.relevant; row[3] = classifier; row[4] = at;
  if (decision.relevant === true) related[doc.name] = {rev: doc.rev, title: doc.title, url: `https://datatracker.ietf.org/doc/${doc.name}/`, reason: decision.reason};
  else delete related[doc.name];
}
export function migrate(input: any): {state: State; related: Record<string, Related>} {
  if (input.version === 2) return {state: input, related: {}};
  if (!input.entries || typeof input.entries !== 'object') throw new Error('Unsupported catalog schema');
  const state = empty(); state.lastSuccess = input.lastSuccess;
  const related: Record<string, Related> = {};
  for (const entry of Object.values(input.entries) as any[]) {
    const doc = entry.document as Document;
    const old = state.index[doc.name];
    if (old && old[0] > doc.rev) continue;
    ingest(state, doc);
    setDecision(state, related, doc, entry.decision, 'legacy', entry.classifiedAt ?? '');
    if (entry.decision.relevant === null && !entry.classifiedAt) state.index[doc.name] = [state.index[doc.name][0], state.index[doc.name][1], null];
  }
  return {state, related};
}
export function encode(state: State): string {
  // One compact row per document keeps diffs readable without verbose metadata.
  const rows = Object.entries(state.index).sort(([a], [b]) => a.localeCompare(b));
  return `{\n"version":2,\n"lastSuccess":${JSON.stringify(state.lastSuccess ?? null)},\n"index":{\n${rows.map(([name, row]) => `${JSON.stringify(name)}:${JSON.stringify(row)}`).join(',\n')}\n}\n}\n`;
}
