try {
  for(const [id,path] of [['protocol','./protocol.js'],['client','./client.js']]) {
    const response=await fetch(path);if(!response.ok) throw new Error('Source unavailable');
    document.getElementById(id).textContent=await response.text();
  }
  document.getElementById('source-status').textContent='現在の公開版に対応するソースです。';
} catch {document.getElementById('source-status').textContent='ソースを取得できませんでした。GitHub のコードを参照してください。';}
