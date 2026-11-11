import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodeGrant,MemoryStore,challenge,checkState,randomValue,CLIENT_ID,REDIRECT_URI,CODE_TTL,TOKEN_TTL} from '../site/samples/pkce/protocol.js';
import worker,{PKCEIssuer} from '../src/worker.ts';
async function fixture() {
 let now=1_000_000;
 const store=new MemoryStore();const grant=new CodeGrant(store,()=>now);
 const verifier=randomValue(),state=randomValue();
 const params={response_type:'code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,scope:'demo.read',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'};
 const callback=new URL(await grant.authorize(params));
 const exchange={grant_type:'authorization_code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,code:callback.searchParams.get('code'),code_verifier:verifier};
 return {grant,store,verifier,state,params,callback,exchange,advance:(ms:number)=>{now+=ms;}};
}
test('authorization code grant binds S256 proof and reaches protected resource',async()=>{
 const f=await fixture();checkState(f.state,f.callback.searchParams.get('state'));
 assert.equal(f.callback.origin,'https://client.example');
 const token=await f.grant.exchange(f.exchange);
 assert.equal(token.token_type,'Bearer');assert.equal(token.scope,'demo.read');
 assert.equal((await f.grant.resource(token.access_token)).subject,'demo-user');
 await assert.rejects(f.grant.exchange(f.exchange),/invalid_grant/);
});
test('stolen code cannot be redeemed with a different or malformed verifier',async()=>{
 const f=await fixture();
 await assert.rejects(f.grant.exchange({...f.exchange,code_verifier:randomValue()}),/invalid_grant/);
 await assert.rejects(f.grant.exchange({...f.exchange,code_verifier:'short'}),/invalid_grant/);
 assert.ok((await f.grant.exchange(f.exchange)).access_token);
});
test('code binds exact client and redirect URI, and unsupported grant is rejected',async()=>{
 const f=await fixture();
 for(const patch of [{client_id:'attacker'},{redirect_uri:'https://evil.example/callback'},{code:randomValue()}]) await assert.rejects(f.grant.exchange({...f.exchange,...patch}),/invalid_grant/);
 await assert.rejects(f.grant.exchange({...f.exchange,grant_type:'password'}),/unsupported_grant_type/);
});
test('plain, missing challenge, unregistered redirect and unexpected scope cannot issue codes',async()=>{
 const f=await fixture();
 for(const patch of [{code_challenge_method:'plain'},{code_challenge:''},{redirect_uri:'https://client.example/callback/extra'},{client_id:'unknown'},{state:''}]) await assert.rejects(f.grant.authorize({...f.params,...patch}),/invalid_request/);
 await assert.rejects(f.grant.authorize({...f.params,scope:'admin'}),/invalid_scope/);
});
test('expired code and expired bearer token are rejected',async()=>{
 const f=await fixture();f.advance(CODE_TTL);await assert.rejects(f.grant.exchange(f.exchange),/invalid_grant/);
 const other=await fixture();const token=await other.grant.exchange(other.exchange);other.advance(TOKEN_TTL);
 await assert.rejects(other.grant.resource(token.access_token),/invalid_token/);
 await assert.rejects(other.grant.resource('not-a-token'),/invalid_token/);
});
test('client stops at altered state before calling the token endpoint',()=>{
 let requests=0;
 assert.throws(()=>{checkState('expected','altered');requests++;},/state_mismatch/);
 assert.equal(requests,0);
});
test('concurrent redemption succeeds once and produces exactly one token',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.grant.exchange(f.exchange),f.grant.exchange(f.exchange)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal([...f.store.records.keys()].filter(key=>key.startsWith('token:')).length,1);
});
function httpFixture() {
 const store:any=new MemoryStore();store.getAlarm=async()=>null;store.setAlarm=async()=>{};store.list=async()=>store.records;
 const issuer=new PKCEIssuer({storage:store});
 const env={PKCE_ISSUER:{idFromName:()=> 'demo',get:()=>({fetch:(request:Request)=>issuer.fetch(request)})}};
 return {issuer,fetch:(request:Request)=>worker.fetch(request,env)};
}
test('Worker HTTP consent, callback, exchange and resource integration',async()=>{
 const f=await fixture();const http=httpFixture();const query=new URLSearchParams(f.params).toString();
 const page=await http.fetch(new Request(`https://issuer.example/authorize?${query}`));
 assert.equal(page.status,200);assert.ok((await page.text()).includes('許可する'));
 const consent=await http.fetch(new Request(`https://issuer.example/consent?${query}`,{method:'POST',headers:{Origin:'https://issuer.example','Content-Type':'application/x-www-form-urlencoded'},body:'decision=allow'}));
 assert.equal(consent.status,302);assert.equal(consent.headers.get('Cache-Control'),'no-store');
 const callback=new URL(consent.headers.get('Location')!);checkState(f.state,callback.searchParams.get('state'));
 const tokenResponse=await http.fetch(new Request('https://issuer.example/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...f.exchange,code:callback.searchParams.get('code')!})}));
 assert.equal(tokenResponse.status,200);const token:any=await tokenResponse.json();
 const resource=await http.fetch(new Request('https://issuer.example/resource',{headers:{Authorization:`Bearer ${token.access_token}`}}));
 assert.equal(resource.status,200);assert.equal((await resource.json() as any).scope,'demo.read');
});
test('Worker rejects duplicate parameters, unsafe consent origin and wrong token content type',async()=>{
 const f=await fixture();const http=httpFixture();const query=new URLSearchParams(f.params).toString();
 assert.equal((await http.fetch(new Request(`https://issuer.example/authorize?${query}&client_id=attacker`))).status,400);
 assert.equal((await http.fetch(new Request(`https://issuer.example/consent?${query}`,{method:'POST',headers:{Origin:'https://evil.example'},body:'decision=allow'}))).status,400);
 assert.equal((await http.fetch(new Request('https://issuer.example/token',{method:'POST',body:'{}'}))).status,400);
 const response=await http.fetch(new Request('https://issuer.example/resource'));
 assert.equal(response.status,401);assert.ok(response.headers.get('WWW-Authenticate')?.includes('invalid_token'));
});
test('consent denial echoes state to the registered callback without issuing a code',async()=>{
 const f=await fixture();const http=httpFixture();const query=new URLSearchParams(f.params).toString();
 const response=await http.fetch(new Request(`https://issuer.example/consent?${query}`,{method:'POST',headers:{Origin:'https://issuer.example'},body:'decision=deny'}));
 const callback=new URL(response.headers.get('Location')!);
 assert.equal(callback.searchParams.get('error'),'access_denied');assert.equal(callback.searchParams.get('state'),f.state);assert.equal(callback.searchParams.get('code'),null);
});
