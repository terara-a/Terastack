import {DemoProvider,beginAuthentication,finishAuthentication,linkableSignals} from './protocol.js';
const $=id=>document.getElementById(id);let provider,history=[],latest;
const show=(id,value)=>{$(id).textContent=JSON.stringify(value,null,2);};
async function reset() {
  $('authenticate').disabled=true;$('userinfo').disabled=true;$('reset').disabled=true;
  provider=await DemoProvider.create();history=[];latest=undefined;
  $('history').replaceChildren();show('metadata',provider.metadata());show('registration',{});show('request',{});show('result',{});
  $('status').textContent='準備できました。同じデモ利用者で2回、認証要求を送ってください。';$('comparison').textContent='まだ比較する記録がありません。';
  $('authenticate').disabled=false;$('reset').disabled=false;
}
$('authenticate').addEventListener('click',async()=>{
  $('authenticate').disabled=true;$('reset').disabled=true;$('userinfo').disabled=true;
  try {
    const rp=$('rp').value;
    const client={client_id:'rp-'+rp,sector:'https://rp-'+rp+'.example',redirect_uri:'https://rp-'+rp+'.example/callback',subject_type:$('subject-type').value};
    const flow=await beginAuthentication(provider,client,{user:$('user').value,includeEmail:$('email').checked});
    const result=await finishAuthentication(provider,flow);
    const record={client_id:client.client_id,subject_type:client.subject_type,claims:result.claims,userinfo:result.userinfo,...($('cookie').checked?{cookie:'simulated-browser-session-'+rp}:{})};
    const signals=linkableSignals(history.at(-1),record);
    $('comparison').textContent=history.length ? signals.length?'直前の記録と照合できる値：'+signals.join(' / '):'直前の記録と一致する sub・email・RP Cookie はありません。この3値だけを比較した結果です。':'もう一度、認証要求を送ると比較できます。';
    show('registration',client);show('request',flow.request);show('result',{id_token_claims:result.claims,userinfo:result.userinfo,age_gate:result.userinfo.age_over_18===true?'閲覧を許可（架空の属性）':'閲覧を拒否（架空の属性）'});
    history.push(record);latest=result;
    const item=document.createElement('li'),heading=document.createElement('h3'),pre=document.createElement('pre');
    heading.textContent=`${history.length}. ${client.client_id} / ${client.subject_type}`;pre.textContent=JSON.stringify(record,null,2);item.append(heading,pre);$('history').prepend(item);
    $('status').textContent='PKCEによるコード交換、ID Tokenの署名・issuer・audience・nonce・期限、UserInfoのsub一致を確認しました。';$('userinfo').disabled=false;
  }catch(error){$('status').textContent='拒否：'+error.message;}
  finally{$('authenticate').disabled=false;$('reset').disabled=false;}
});
$('userinfo').addEventListener('click',()=>{
  try {show('result',{id_token_claims:latest.claims,userinfo:provider.userinfo(latest.token.access_token)});$('status').textContent='同じアクセストークンのUserInfoを再取得しました。subは変わりません。';}
  catch(error){$('status').textContent='拒否：'+error.message;}
});
$('reset').addEventListener('click',()=>reset().catch(error=>{$('status').textContent=error.message;}));
reset().catch(error=>{$('status').textContent='準備に失敗：'+error.message;});
