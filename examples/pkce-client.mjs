// Public client: verifier/state remain here; the server receives challenge first.
import {randomValue,challenge,checkState,CLIENT_ID,REDIRECT_URI} from '../site/samples/pkce/protocol.js';
if (!process.argv.includes('--approve')) throw new Error('Pass --approve to explicitly consent as the fixed demo-user. This is a local learning example.');
const base=new URL(process.argv.find(arg=>/^https?:\/\//.test(arg)) ?? 'http://127.0.0.1:8787');
const verifier=randomValue(),state=randomValue();
const params=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,scope:'demo.read',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});
const authorize=await fetch(new URL(`/authorize?${params}`,base),{redirect:'manual'});
if (!authorize.ok) throw new Error(`Authorize failed: ${authorize.status}`);
console.log('Authorization request accepted; explicitly approving as the demo-user.');
const consent=await fetch(new URL(`/consent?${params}`,base),{method:'POST',redirect:'manual',headers:{Origin:base.origin,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=allow'});
if (consent.status!==302) throw new Error(`Consent failed: ${consent.status}`);
const callback=new URL(consent.headers.get('Location'));
checkState(state,callback.searchParams.get('state')); // Before any token request.
const token=await fetch(new URL('/token',base),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,code:callback.searchParams.get('code'),code_verifier:verifier})});
if (!token.ok) throw new Error(`Exchange failed: ${token.status}`);
const credentials=await token.json();
const resource=await fetch(new URL('/resource',base),{headers:{Authorization:`Bearer ${credentials.access_token}`}});
if (!resource.ok) throw new Error(`Resource failed: ${resource.status}`);
console.log('State verified; PKCE code exchange succeeded. Resource:',await resource.json());
