// RFC 6749 authorization code grant + RFC 7636 S256, simulated locally in the browser.
export const CLIENT_ID = 'terastack-demo';
export const REDIRECT_URI = 'https://client.example/callback';
export const CODE_TTL = 300_000;
export const TOKEN_TTL = 600_000;
export function randomValue() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function challenge(verifier) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError('invalid_grant');
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}
export class OAuthError extends Error {
  constructor(code) { super(code); this.name='OAuthError'; this.code=code; }
}
export function checkState(expected, received) {
  if (!expected || expected !== received) throw new OAuthError('state_mismatch');
}
export function validateAuthorization(params) {
    if (params.client_id !== CLIENT_ID || params.redirect_uri !== REDIRECT_URI) throw new OAuthError('invalid_request');
    if (params.response_type !== 'code') throw new OAuthError('unsupported_response_type');
    if (params.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge ?? '')) throw new OAuthError('invalid_request');
    if (params.scope !== 'demo.read') throw new OAuthError('invalid_scope');
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.state ?? '')) throw new OAuthError('invalid_request');
}
export class CodeGrant {
  constructor(store, now=()=>Date.now()) { this.store=store; this.now=now; }
  async authorize(params) {
    validateAuthorization(params);
    const code=randomValue();
    await this.store.put(`code:${code}`,{client:params.client_id,redirect:params.redirect_uri,challenge:params.code_challenge,expires:this.now()+CODE_TTL});
    const callback=new URL(REDIRECT_URI); callback.searchParams.set('code',code); callback.searchParams.set('state',params.state);
    return callback.href;
  }
  async exchange(params) {
    if (params.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type');
    const proof=await challenge(params.code_verifier);
    const accessToken=randomValue();
    const token=await this.store.transaction(async tx=>{
      const key=`code:${params.code}`; const record=await tx.get(key);
      if (!record || record.expires <= this.now() || record.client !== params.client_id || record.redirect !== params.redirect_uri || record.challenge !== proof) throw new OAuthError('invalid_grant');
      await tx.delete(key); // Consume in the same transaction as token creation.
      await tx.put(`token:${accessToken}`,{subject:'demo-user',scope:'demo.read',expires:this.now()+TOKEN_TTL});
      return {access_token:accessToken,token_type:'Bearer',expires_in:TOKEN_TTL/1000,scope:'demo.read'};
    });
    return token;
  }
  async resource(accessToken) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken ?? '')) throw new OAuthError('invalid_token');
    const record=await this.store.get(`token:${accessToken}`);
    if (!record || record.expires <= this.now()) throw new OAuthError('invalid_token');
    return {subject:record.subject,scope:record.scope,message:'保護されたリソースを取得しました'};
  }
}
// Browser-only storage. A local simulation does not establish a server trust boundary.
export class MemoryStore {
  constructor() { this.records=new Map(); this.queue=Promise.resolve(); }
  serial(operation) {
    const run=this.queue.then(operation); this.queue=run.catch(()=>{}); return run;
  }
  async get(key) { await this.queue; return structuredClone(this.records.get(key)); }
  async put(key,value) { return this.serial(()=>{this.records.set(key,structuredClone(value));}); }
  async delete(key) { return this.serial(()=>this.records.delete(key)); }
  async transaction(operation) {
    return this.serial(async()=>{
      const records=structuredClone(this.records);
      const tx={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>{records.set(key,structuredClone(value));},delete:async key=>records.delete(key)};
      const result=await operation(tx); this.records=records; return result;
    });
  }
}
