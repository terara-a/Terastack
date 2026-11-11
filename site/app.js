const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('ja-JP').format(value);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tokyo'}).format(new Date(value)) : '未収集';
let snapshot; let page = 0; const size = 25;
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function render() {
  const query = $('search').value.trim().toLowerCase(); const type = $('type').value; const review = $('review').value;
  const filtered = snapshot.documents.filter(doc => (type === 'all' || type === doc.type) && (review === 'all' || review === doc.status) && `${doc.name} ${doc.title} ${doc.reason}`.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / size)); page = Math.min(page, pages - 1);
  $('results').textContent = `${number(filtered.length)} 件`; $('documents').replaceChildren();
  if (!filtered.length) {
    const empty = element('div', '', 'empty'); empty.append(element('h3', snapshot.documents.length ? '一致する文書がありません' : '関連文書はまだありません'), element('p', snapshot.documents.length ? '検索語や種類を変更してください。' : '収集済みの文書は索引に保存されています。分類が進むと、関連する仕様がここに表示されます。')); $('documents').append(empty);
  }
  for (const doc of filtered.slice(page * size, (page + 1) * size)) {
    const article = element('article', '', 'document');
    article.append(element('span', doc.status === 'confirmed' ? '確認済み' : '関連候補・未確認', 'badge'), element('span', doc.type, 'badge'), element('span', `${doc.name}${doc.rev ? ` / rev ${doc.rev}` : ''}`, 'document-name'));
    const heading = element('h3', ''); const link = element('a', doc.title || doc.name); link.href = doc.url; heading.append(link); article.append(heading, element('p', doc.reason)); $('documents').append(article);
  }
  $('page').textContent = `${page + 1} / ${pages}`; $('previous').disabled = page === 0; $('next').disabled = page >= pages - 1;
}
for (const id of ['search','type','review']) $(id).addEventListener('input', () => { page = 0; if (snapshot) render(); });
$('previous').addEventListener('click', () => { page--; render(); }); $('next').addEventListener('click', () => { page++; render(); });
$('pkce').addEventListener('submit', async event => {
  event.preventDefault();
  const verifier = $('verifier').value;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) { $('challenge').textContent = '使用できる文字と長さを確認してください。'; return; }
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    $('challenge').textContent = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  } catch { $('challenge').textContent = 'このブラウザでは計算できません。HTTPS で開いてください。'; }
});
fetch('./data.json').then(response => { if (!response.ok) throw new Error('Fetch failed'); return response.json(); }).then(data => {
  snapshot = data; $('total').textContent = number(data.counts.total); $('relevant').textContent = data.review ? `${number(data.review.confirmed)} / ${number(data.review.candidates)}` : number(data.counts.relevant); $('pending').textContent = number(data.review?.unreviewed ?? data.counts.pending);
  $('breakdown').textContent = `RFC ${number(data.counts.rfc)} / Draft ${number(data.counts.draft)}`;
  $('freshness').textContent = `最終収集：${date(data.lastCollection)}（日本時間）`;
  $('classification').textContent = data.review ? `候補抽出済み ${number(data.review.screened)} 件。低スコアも未確認として保持` : '未判定・判断困難な文書';
  for (const report of data.daily) { const tr = element('tr',''); tr.append(element('td',date(report.at)),element('td',number(report.changed)),element('td',number(report.relevant))); $('updates-body').append(tr); }
  $('no-updates').hidden = data.daily.length > 0; render();
}).catch(() => { $('error').hidden = false; $('error').textContent = 'データを読み込めませんでした。時間をおいて再読み込みするか、GitHub のカタログを確認してください。'; $('freshness').textContent = '収集状況を表示できません'; });
