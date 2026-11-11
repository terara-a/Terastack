import {CodeGrant,MemoryStore,randomValue,challenge,checkState,CLIENT_ID,REDIRECT_URI} from './protocol.js';
const $=id=>document.getElementById(id);
let server,verifier,state,params,callback,token;
function log(title,value) {
  const item=document.createElement('li'),heading=document.createElement('h3'),body=document.createElement('pre');
  heading.textContent=title;body.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);item.append(heading,body);$('trace').append(item);
}
function reset() {
  server=new CodeGrant(new MemoryStore()); verifier=state=params=callback=token=undefined;
  $('trace').replaceChildren();$('secrets').textContent='未生成';$('status').textContent='1. 認可要求を作ってください。';
  for(const id of ['prepare','authorize','exchange','resource','attack','state-attack','replay']) $(id).disabled=id!=='prepare';
}
function handle(id,operation) { $(id).addEventListener('click',async()=>{ $(id).disabled=true;try {await operation();} catch(error) {log('拒否 / エラー',{error:error.code??'demo_error'});$('status').textContent=`拒否されました：${error.code??'demo_error'}。必要なら最初から実行してください。`;} }); }
function exchangeParams(code,proof=verifier) { return {grant_type:'authorization_code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,code,code_verifier:proof}; }
handle('prepare',async()=>{
  verifier=randomValue();state=randomValue();
  params={response_type:'code',client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,scope:'demo.read',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'};
  $('secrets').textContent=JSON.stringify({code_verifier:verifier,state},null,2);
  log('Client → 認可サーバー：GET /authorize',params);$('authorize').disabled=false;$('status').textContent='2. 認可要求には challenge を送信。デモ利用者が許可します。';
});
handle('authorize',async()=>{
  callback=new URL(await server.authorize(params));
  log('認可サーバー → ブラウザ → Client：302 callback',callback.href);
  log('認可サーバーが保持する結び付き',{code:callback.searchParams.get('code'),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,code_challenge:params.code_challenge,expires_in:300});
  for(const id of ['exchange','attack','state-attack']) $(id).disabled=false;
  $('status').textContent='3. callback の state を確認してから、code と verifier を送信します。';
});
handle('attack',async()=>{
  const request=exchangeParams(callback.searchParams.get('code'),randomValue());
  log('攻撃者 → token endpoint：盗んだ code + 別の verifier',request);
  try { await server.exchange(request); throw new Error('Unexpected acceptance'); }
  catch(error) { if(error.code!=='invalid_grant') throw error; log('認可サーバー：400 invalid_grant',{error:error.code,reason:'S256(verifier) が記録した challenge と一致しない。正しいクライアントはまだ交換できます。'}); }
});
handle('state-attack',async()=>{
  try {checkState(state,randomValue());throw new Error('Unexpected acceptance');}
  catch(error) {if(error.code!=='state_mismatch') throw error;log('Client：state 不一致で中止',{error:error.code,token_request_sent:false});}
});
handle('exchange',async()=>{
  checkState(state,callback.searchParams.get('state')); log('Client：state 一致',{verified:true});
  const request=exchangeParams(callback.searchParams.get('code'));log('Client → 認可サーバー：POST /token',request);
  token=await server.exchange(request);log('認可サーバー → Client：200',token);
  $('resource').disabled=false;$('replay').disabled=false;$('attack').disabled=true;$('state-attack').disabled=true;
  $('status').textContent='4. コードは消費済み。トークンでリソースを取得できます。';
});
handle('replay',async()=>{
  try {await server.exchange(exchangeParams(callback.searchParams.get('code')));throw new Error('Unexpected acceptance');}
  catch(error) {if(error.code!=='invalid_grant') throw error;log('認可サーバー：使用済みコードを拒否',{error:error.code});}
});
handle('resource',async()=>{
  log('Client → Resource：GET /resource',{Authorization:`Bearer ${token.access_token}`});
  log('Resource → Client：200',await server.resource(token.access_token));$('status').textContent='認可要求 → コード発行 → PKCE 検証 → リソース取得が完了しました。';
});
$('reset').addEventListener('click',reset);reset();
