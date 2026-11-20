// Browser-local OIDC teaching model. No HTTP endpoints or real user authentication.
import {randomValue, challenge, checkState} from '../pkce/protocol.js';
export const ISSUER = 'https://op.example';
export const TYPES = Object.freeze(['public','pairwise','ephemeral']);
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const jsonPart = value => encode(new TextEncoder().encode(JSON.stringify(value)));
function decode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('invalid_id_token');
  return Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4)), c=>c.charCodeAt(0));
}
const profile = user => {
  if (user === 'adult') return {age_over_18:true,email:'adult@example.invalid'};
  if (user === 'minor') return {age_over_18:false,email:'minor@example.invalid'};
  throw new Error('unknown_demo_user');
};
export class DemoProvider {
  // random is injectable for collision tests; the browser demo uses Web Crypto.
  constructor(keys, {now=()=>Date.now(), random=randomValue}={}) {
    this.keys=keys;this.now=now;this.random=random;
    this.clients=new Map();this.subjects=new Map();this.issued=new Set();this.codes=new Map();this.tokens=new Map();
  }
  static async create(options) {
    const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
    return new DemoProvider(keys,options);
  }
  metadata() {
    return {issuer:ISSUER,authorization_endpoint:ISSUER+'/authorize',token_endpoint:ISSUER+'/token',userinfo_endpoint:ISSUER+'/userinfo',jwks_uri:ISSUER+'/jwks',
      subject_types_supported:TYPES.slice(),response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']};
  }
  register(client) {
    if (!TYPES.includes(client.subject_type) || !client.client_id || !/^https:\/\//.test(client.redirect_uri) || !client.sector) throw new Error('invalid_client_registration');
    this.clients.set(client.client_id,structuredClone(client));
  }
  freshSubject() {
    for(let attempt=0;attempt<8;attempt++) {
      const value=this.random();
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('invalid_subject_generator');
      if (!this.issued.has(value)) {this.issued.add(value);return value;}
    }
    throw new Error('subject_generation_failed');
  }
  subject(user,client) {
    if(client.subject_type==='ephemeral') return this.freshSubject();
    const key=JSON.stringify([client.subject_type,client.subject_type==='pairwise'?client.sector:'',user]);
    if(!this.subjects.has(key)) this.subjects.set(key,this.freshSubject());
    return this.subjects.get(key);
  }
  async jwks() { return {keys:[{...await crypto.subtle.exportKey('jwk',this.keys.publicKey),kid:'demo-rs256',use:'sig',alg:'RS256'}]}; }
  authorize(params, user='adult') {
    const client=this.clients.get(params.client_id);
    const scopes=(params.scope??'').split(' ');
    if (!client || params.redirect_uri!==client.redirect_uri || params.response_type!=='code' || params.code_challenge_method!=='S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge??'') || !/^[A-Za-z0-9_-]{43}$/.test(params.state??'') || !/^[A-Za-z0-9_-]{43}$/.test(params.nonce??'') ||
        !scopes.includes('openid') || scopes.some(s=>!['openid','age.demo','email'].includes(s))) throw new Error('invalid_authorization_request');
    const attributes=profile(user); // Fixed test fixtures, not real age assurance.
    const code=randomValue();
    this.codes.set(code,{client:structuredClone(client),sub:this.subject(user,client),nonce:params.nonce,challenge:params.code_challenge,scopes,attributes,expires:this.now()+300000});
    const callback=new URL(client.redirect_uri);callback.searchParams.set('code',code);callback.searchParams.set('state',params.state);return callback.href;
  }
  async exchange(params) {
    if (params.grant_type!=='authorization_code') throw new Error('unsupported_grant_type');
    const proof=await challenge(params.code_verifier);
    const record=this.codes.get(params.code);
    if (!record || record.expires<=this.now() || params.client_id!==record.client.client_id || params.redirect_uri!==record.client.redirect_uri || proof!==record.challenge) throw new Error('invalid_grant');
    // Consume before awaiting signing, so concurrent exchanges can succeed only once.
    this.codes.delete(params.code);
    const now=Math.floor(this.now()/1000);
    const claims={iss:ISSUER,sub:record.sub,aud:record.client.client_id,iat:now,exp:now+600,nonce:record.nonce};
    const input=jsonPart({alg:'RS256',kid:'demo-rs256',typ:'JWT'})+'.'+jsonPart(claims);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',this.keys.privateKey,new TextEncoder().encode(input));
    const accessToken=randomValue();
    const userinfo={sub:record.sub,...(record.scopes.includes('age.demo')?{age_over_18:record.attributes.age_over_18}:{}),...(record.scopes.includes('email')?{email:record.attributes.email}:{})};
    this.tokens.set(accessToken,{userinfo,expires:this.now()+600000});
    return {access_token:accessToken,token_type:'Bearer',expires_in:600,id_token:input+'.'+encode(new Uint8Array(signature))};
  }
  userinfo(token) {
    const record=this.tokens.get(token);
    if(!record || record.expires<=this.now()) throw new Error('invalid_token');
    return structuredClone(record.userinfo);
  }
}
export async function verifyIDToken(token,jwks,{client_id,nonce,now=Date.now()}) {
  if(typeof token!=='string' || token.length>16384) throw new Error('invalid_id_token');
  const parts=token.split('.');if(parts.length!==3) throw new Error('invalid_id_token');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const key=jwks.keys.find(k=>k.kid===header.kid && k.alg==='RS256' && k.kty==='RSA' && k.use==='sig');
  if(header.alg!=='RS256' || header.crit!==undefined || !key) throw new Error('invalid_id_token');
  const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))) throw new Error('invalid_id_token');
  const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(claims.iss!==ISSUER || claims.aud!==client_id || !nonce || claims.nonce!==nonce || typeof claims.sub!=='string' || !claims.sub || !Number.isFinite(claims.exp) || now/1000>=claims.exp || !Number.isFinite(claims.iat) || claims.iat>now/1000+30) throw new Error('invalid_id_token');
  return claims;
}
export function bindUserInfo(claims,userinfo) {
  if(userinfo.sub!==claims.sub) throw new Error('userinfo_subject_mismatch');
  return userinfo;
}
export async function beginAuthentication(provider,client,{user='adult',includeEmail=false}={}) {
  provider.register(client); // subject_type is registration metadata, not an auth request parameter.
  const verifier=randomValue(),state=randomValue(),nonce=randomValue();
  const request={response_type:'code',client_id:client.client_id,redirect_uri:client.redirect_uri,scope:'openid age.demo'+(includeEmail?' email':''),state,nonce,code_challenge:await challenge(verifier),code_challenge_method:'S256'};
  const callback=new URL(provider.authorize(request,user));
  return {client,request,callback,verifier,state,nonce};
}
export async function finishAuthentication(provider,flow) {
  checkState(flow.state,flow.callback.searchParams.get('state'));
  const token=await provider.exchange({grant_type:'authorization_code',client_id:flow.client.client_id,redirect_uri:flow.client.redirect_uri,code:flow.callback.searchParams.get('code'),code_verifier:flow.verifier});
  const claims=await verifyIDToken(token.id_token,await provider.jwks(),{client_id:flow.client.client_id,nonce:flow.nonce,now:provider.now()});
  const userinfo=bindUserInfo(claims,provider.userinfo(token.access_token));
  return {token,claims,userinfo};
}
export function linkableSignals(previous,current) {
  if(!previous) return [];
  const signals=[];
  if(previous.claims.iss===current.claims.iss && previous.claims.sub===current.claims.sub) signals.push('iss + sub');
  if(previous.userinfo.email && previous.userinfo.email===current.userinfo.email) signals.push('email');
  if(previous.client_id===current.client_id && previous.cookie && previous.cookie===current.cookie) signals.push('RP Cookie');
  return signals;
}
