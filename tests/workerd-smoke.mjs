// Run against `wrangler dev`; validates the actual SQLite Durable Object, not MemoryStore.
import assert from 'node:assert/strict';
import {randomValue,challenge,checkState,CLIENT_ID,REDIRECT_URI} from '../site/samples/pkce/protocol.js';
const base=process.argv[2] ?? 'http://127.0.0.1:8787';
async function issued() {
 const verifier=randomValue(),state=randomValue();
 const params=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,scope:'demo.read',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});
 const authorize=await fetch(`${base}/authorize?${params}`);assert.equal(authorize.status,200);
 const consent=await fetch(`${base}/consent?${params}`,{method:'POST',redirect:'manual',headers:{Origin:new URL(base).origin,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=allow'});
 assert.equal(consent.status,302);const callback=new URL(consent.headers.get('Location'));checkState(state,callback.searchParams.get('state'));
 return {grant_type:'authorization_code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,code:callback.searchParams.get('code'),code_verifier:verifier};
}
const redeem=params=>fetch(`${base}/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
const first=await issued();
assert.equal((await redeem({...first,code_verifier:randomValue()})).status,400);
assert.equal((await redeem({...first,client_id:'wrong'})).status,400);
assert.equal((await redeem({...first,redirect_uri:'https://evil.example/'})).status,400);
const accepted=await redeem(first);assert.equal(accepted.status,200);const token=await accepted.json();
assert.equal((await fetch(`${base}/resource`,{headers:{Authorization:`Bearer ${token.access_token}`}})).status,200);
assert.equal((await redeem(first)).status,400);
const second=await issued();const concurrent=await Promise.all([redeem(second),redeem(second)]);
assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,400]);
console.log('workerd + SQLite DO passed: HTTP code grant, PKCE/client/redirect rejection, bearer resource, replay and concurrent one-time redemption');
