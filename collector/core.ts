export type Document = {name: string; rev: string; title: string; abstract?: string; time: string; resource_uri: string};
export const API = 'https://datatracker.ietf.org';
export async function getJson(url: string, fetcher = fetch): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, {signal: AbortSignal.timeout(30000), headers: {'User-Agent': 'Terastack standards monitor'}});
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw last;
}
export async function* documents(since?: string, fetcher = fetch, type: 'draft' | 'rfc' = 'draft'): AsyncGenerator<Document> {
  // No topic, keyword or WG filters: new protocol names enter the same pipeline.
  let url: string | null = `${API}/api/v1/doc/document/?type=${type}&limit=100${since ? `&time__gte=${encodeURIComponent(since)}` : ''}`;
  const visited = new Set<string>();
  while (url) {
    const parsed = new URL(url, API);
    if (parsed.origin !== API || !parsed.pathname.startsWith('/api/')) throw new Error('Unexpected pagination destination');
    if (visited.has(parsed.href)) throw new Error('Pagination loop');
    visited.add(parsed.href);
    const page = await getJson(parsed.href, fetcher);
    if (!Array.isArray(page.objects) || !page.meta || !('next' in page.meta)) throw new Error('Unexpected Datatracker schema');
    for (const doc of page.objects) {
      if (typeof doc.name !== 'string' || typeof doc.rev !== 'string' || typeof doc.time !== 'string') throw new Error('Invalid document');
      yield doc;
    }
    url = page.meta.next;
  }
}
export function overlap(lastSuccess?: string): string | undefined {
  return lastSuccess ? new Date(Date.parse(lastSuccess) - 3 * 86400000).toISOString() : undefined;
}
