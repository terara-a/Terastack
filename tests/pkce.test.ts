import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodeGrant,MemoryStore,challenge,checkState,randomValue,CLIENT_ID,REDIRECT_URI,CODE_TTL,TOKEN_TTL} from '../site/samples/pkce/protocol.js';
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
