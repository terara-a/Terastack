import {CodeGrant, OAuthError, REDIRECT_URI, challenge, validateAuthorization} from '../site/samples/pkce/protocol.js';
export {challenge};
function json(data: unknown, status=200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer'}}); }
function single(params: URLSearchParams, names: string[]) {
  const result: Record<string,string> = {};
  for (const name of names) {
    if (params.getAll(name).length !== 1) throw new OAuthError('invalid_request');
    result[name]=params.get(name)!;
  }
  return result;
}
export class PKCEIssuer {
  state: any;
  grant: CodeGrant;
  constructor(state: any) { this.state=state; this.grant=new CodeGrant(state.storage); }
  async fetch(request: Request) {
    const url=new URL(request.url);
    try {
      if (url.pathname === '/authorize' && request.method === 'GET') {
        const params=single(url.searchParams,['response_type','client_id','redirect_uri','scope','state','code_challenge','code_challenge_method']);
        // Validate before displaying the fixed demo user's consent. Do not redirect errors to arbitrary URIs.
        validateAuthorization(params);
        const action='/consent?'+new URLSearchParams(params).toString();
        return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>PKCE デモの同意</title><h1>デモ利用者として許可</h1><p>認証処理は省略した学習用サーバーです。demo-user の demo.read を terastack-demo に許可します。</p><form method="post" action="${action.replace(/&/g,'&amp;')}"><button name="decision" value="allow">許可する</button><button name="decision" value="deny">拒否する</button></form></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
      }
      if (url.pathname === '/consent' && request.method === 'POST') {
        if (request.headers.get('Origin') !== url.origin) throw new OAuthError('invalid_request');
        const params=single(url.searchParams,['response_type','client_id','redirect_uri','scope','state','code_challenge','code_challenge_method']);
        const form=new URLSearchParams(await request.text());
        const decision=single(form,['decision']).decision;
        validateAuthorization(params);
        if (!['allow','deny'].includes(decision)) throw new OAuthError('invalid_request');
        if (decision === 'deny') {
          const callback=new URL(REDIRECT_URI);callback.searchParams.set('error','access_denied');callback.searchParams.set('state',params.state);
          return new Response(null,{status:302,headers:{Location:callback.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
        }
        const callback=await this.grant.authorize(params);
        const alarm=await this.state.storage.getAlarm();
        if (alarm === null) await this.state.storage.setAlarm(Date.now()+300_000);
        return new Response(null,{status:302,headers:{Location:callback,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) throw new OAuthError('invalid_request');
        const form=new URLSearchParams(await request.text());
        return json(await this.grant.exchange(single(form,['grant_type','client_id','redirect_uri','code','code_verifier'])));
      }
      if (url.pathname === '/resource' && request.method === 'GET') {
        const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        return json(await this.grant.resource(token));
      }
      return json({error:'not_found'},404);
    } catch(error) {
      if (!(error instanceof OAuthError)) throw error;
      const status=error.code === 'invalid_token' ? 401 : 400;
      const response=json({error:error.code},status);
      if (status===401) response.headers.set('WWW-Authenticate','Bearer error="invalid_token"');
      return response;
    }
  }
  async alarm() {
    const records=await this.state.storage.list(); let next=Infinity;
    for (const [key,record] of records) {
      if (record.expires <= Date.now()) await this.state.storage.delete(key);
      else next=Math.min(next,record.expires);
    }
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
  }
}
export default {
  async fetch(request: Request, env?: any): Promise<Response> {
    const path=new URL(request.url).pathname;
    if (path==='/health') return json({status:'ok'});
    if (!['/authorize','/consent','/token','/resource'].includes(path)) return json({error:'not_found'},404);
    if (!env?.PKCE_ISSUER) return json({error:'issuer_not_configured'},503);
    return env.PKCE_ISSUER.get(env.PKCE_ISSUER.idFromName('demo')).fetch(request);
  }
};
