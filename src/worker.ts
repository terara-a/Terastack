// Stateless educational examples. No tokens, codes or credentials are issued.
export async function challenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('Invalid PKCE verifier');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({status: 'ok'});
    if (url.pathname !== '/examples/pkce' || request.method !== 'POST') return new Response('Not found', {status: 404});
    try {
      const body = await request.json() as {verifier?: unknown};
      if (typeof body.verifier !== 'string') throw new Error('Missing verifier');
      return Response.json({code_challenge: await challenge(body.verifier), code_challenge_method: 'S256'}, {headers: {'Cache-Control': 'no-store'}});
    } catch { return Response.json({error: 'invalid_request'}, {status: 400}); }
  }
};
