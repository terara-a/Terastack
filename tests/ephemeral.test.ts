import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DemoProvider,beginAuthentication,finishAuthentication,verifyIDToken,bindUserInfo,linkableSignals,ISSUER} from '../site/samples/ephemeral-subject/protocol.js';
const shared=await DemoProvider.create();
const op=(options={})=>new DemoProvider(shared.keys,options);
const client=(type='ephemeral',id='a',sector=`https://${id}.example`)=>({client_id:id,sector,redirect_uri:`https://${id}.example/callback`,subject_type:type});
const authenticate=async(provider,c=client(),options={})=>finishAuthentication(provider,await beginAuthentication(provider,c,options));

test('ephemeral is registration metadata; every authentication has a fresh sub but UserInfo retains its binding',async()=>{
 const provider=op();assert.ok(provider.metadata().subject_types_supported.includes('ephemeral'));
 const first=await beginAuthentication(provider,client());assert.ok(!('subject_type' in first.request));
 const a=await finishAuthentication(provider,first);const b=await authenticate(provider);const other=await authenticate(provider,client('ephemeral','b'));
 assert.match(a.claims.sub,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a.claims.sub,b.claims.sub);assert.notEqual(b.claims.sub,other.claims.sub);
 assert.equal(a.claims.sub,a.userinfo.sub);assert.deepEqual(provider.userinfo(a.token.access_token),a.userinfo);
 assert.equal(provider.userinfo(a.token.access_token).sub,a.claims.sub);
});
test('public is stable across clients; pairwise is stable per sector including clients sharing a sector',async()=>{
 const provider=op();const a=await authenticate(provider,client('public'));const b=await authenticate(provider,client('public','b'));assert.equal(a.claims.sub,b.claims.sub);
 const pairA=await authenticate(provider,client('pairwise'));const pairAgain=await authenticate(provider,client('pairwise'));const pairB=await authenticate(provider,client('pairwise','b'));const sameSector=await authenticate(provider,client('pairwise','c','https://a.example'));
 assert.equal(pairA.claims.sub,pairAgain.claims.sub);assert.notEqual(pairA.claims.sub,pairB.claims.sub);assert.equal(pairA.claims.sub,sameSector.claims.sub);
});
test('CSPRNG candidate collisions are retried; persistent duplicate candidates fail closed',async()=>{
 const candidates=['A'.repeat(43),'A'.repeat(43),'B'.repeat(43)];const provider=op({random:()=>candidates.shift()??'B'.repeat(43)});
 const a=await authenticate(provider);const b=await authenticate(provider);assert.notEqual(a.claims.sub,b.claims.sub);
 await assert.rejects(authenticate(provider),/subject_generation_failed/);
});
test('PKCE binds the code, rejects replay, and concurrent exchanges succeed only once',async()=>{
 const provider=op();const flow=await beginAuthentication(provider,client());const params={grant_type:'authorization_code',client_id:'a',redirect_uri:flow.client.redirect_uri,code:flow.callback.searchParams.get('code'),code_verifier:flow.verifier};
 await assert.rejects(provider.exchange({...params,code_verifier:'A'.repeat(43)}),/invalid_grant/);
 await assert.rejects(provider.exchange({...params,client_id:'other'}),/invalid_grant/);
 await assert.rejects(provider.exchange({...params,redirect_uri:'https://evil.example/'}),/invalid_grant/);
 const results=await Promise.allSettled([provider.exchange(params),provider.exchange(params)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(provider.exchange(params),/invalid_grant/);
});
test('state is checked before token exchange and invalid registration or request cannot silently fall back',async()=>{
 const provider=op();assert.throws(()=>provider.register(client('unsupported')),/registration/);
 const flow=await beginAuthentication(provider,client());assert.throws(()=>provider.authorize({...flow.request,code_challenge_method:'plain'}),/authorization_request/);
 assert.throws(()=>provider.authorize({...flow.request,redirect_uri:'https://evil.example/'}),/authorization_request/);
 assert.throws(()=>provider.authorize({...flow.request,nonce:''}),/authorization_request/);
 let exchanges=0;provider.exchange=async()=>{exchanges++;throw new Error('should not exchange');};flow.callback.searchParams.set('state','altered');
 await assert.rejects(finishAuthentication(provider,flow),/state_mismatch/);assert.equal(exchanges,0);
});
test('ID Token signature, nonce, issuer, audience and expiry are verified; UserInfo sub must match',async()=>{
 const provider=op();const flow=await beginAuthentication(provider,client());const result=await finishAuthentication(provider,flow);const jwks=await provider.jwks();const expected={client_id:'a',nonce:flow.nonce};
 await assert.rejects(verifyIDToken(result.token.id_token,jwks,{...expected,nonce:'wrong'}),/invalid_id_token/);
 await assert.rejects(verifyIDToken(result.token.id_token,jwks,{...expected,client_id:'wrong'}),/invalid_id_token/);
 await assert.rejects(verifyIDToken(result.token.id_token,jwks,{...expected,now:(result.claims.exp+1)*1000}),/invalid_id_token/);
 const parts=result.token.id_token.split('.');const payload={...result.claims,iss:'https://evil.example'};parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 await assert.rejects(verifyIDToken(parts.join('.'),jwks,expected),/invalid_id_token/);
 const input=parts[0]+'.'+parts[1];parts[2]=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',shared.keys.privateKey,new TextEncoder().encode(input))).toString('base64url');
 await assert.rejects(verifyIDToken(parts.join('.'),jwks,expected),/invalid_id_token/);
 parts[0]=Buffer.from(JSON.stringify({alg:'none',kid:'demo-rs256'})).toString('base64url');await assert.rejects(verifyIDToken(parts.join('.'),jwks,expected),/invalid_id_token/);
 parts[0]=Buffer.from(JSON.stringify({alg:'RS256',kid:'demo-rs256',crit:['unsupported']})).toString('base64url');parts[1]=result.token.id_token.split('.')[1];parts[2]=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',shared.keys.privateKey,new TextEncoder().encode(parts[0]+'.'+parts[1]))).toString('base64url');await assert.rejects(verifyIDToken(parts.join('.'),jwks,expected),/invalid_id_token/);
 assert.throws(()=>bindUserInfo(result.claims,{...result.userinfo,sub:'other'}),/userinfo_subject_mismatch/);
 assert.equal(result.claims.iss,ISSUER);
});
test('expired code and access tokens are rejected',async()=>{
 let now=1000000;const provider=op({now:()=>now});const flow=await beginAuthentication(provider,client());now+=300000;await assert.rejects(finishAuthentication(provider,flow),/invalid_grant/);
 const result=await authenticate(provider);now+=600000;assert.throws(()=>provider.userinfo(result.token.access_token),/invalid_token/);
});
test('ephemeral cannot hide fixed email or RP cookies; valid authentication does not grant age eligibility',async()=>{
 const provider=op();const a=await authenticate(provider,client(),{includeEmail:true});const b=await authenticate(provider,client(),{includeEmail:true});
 const first={...a,client_id:'a',cookie:'same-cookie'},second={...b,client_id:'a',cookie:'same-cookie'};assert.deepEqual(linkableSignals(first,second),['email','RP Cookie']);
 assert.deepEqual(linkableSignals({...first,cookie:undefined,userinfo:{sub:a.claims.sub}},{...second,cookie:undefined,userinfo:{sub:b.claims.sub}}),[]);
 assert.deepEqual(linkableSignals(first,{...second,client_id:'b'}),['email']);
 const minor=await authenticate(provider,client(),{user:'minor'});assert.equal(minor.userinfo.age_over_18,false);assert.equal(a.userinfo.age_over_18,true);assert.ok(!('email' in minor.userinfo));
});
