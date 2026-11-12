# 仕様の確認結果を登録する

「確認済み」は、原文に基づく認証・認可との関連性の確認を、PRレビューで採用した記録です。AIが原文確認を担当した場合は `reviewedBy` にAIであることを明記し、その根拠を人がPRで確認して採用します。実装の適合性や安全性を認証する表示ではありません。

確認結果は `catalog/reviewed.json` に保存し、通常のコードPRと同じようにレビューしてマージします。収集処理はこのファイルを書き換えず、生成データの自動マージでも変更を許可しません。

## OpenID仕様

1. `catalog/openid.json` から対象の文書名、`url`、`revision`、`sha256` を確認します。本文が未取得でハッシュがない場合は、日次巡回で取得されてから登録します。依頼を受けて特定の原文を取得する場合は、通常と同じrobots.txt・取得間隔・Retry-Afterを守り、実際に取得したメタデータだけを同じPRの収集ファイルへ追記して照合できます。
2. 対象版の原文を読み、認証・認可との関連理由をまとめます。確認に用いた本文ファイルのSHA-256を計算し、収集結果のハッシュと一致することを確認します。ブラウザで再保存したHTMLは内容が書き換わる場合があるため、取得した元のレスポンス本文を使います。Linuxでは `sha256sum spec.html`、macOSでは `shasum -a 256 spec.html` で計算できます。
3. `catalog/reviewed.json` に `openid:<文書名>` をキーとして追記します。GitHubのファイル編集画面からも変更PRを作れます。既存のIETF記録は残します。
4. PRのPagesビルドを確認してマージします。mainへのマージ後にPagesへ反映されます。

記入例（`<...>` は実際の値に置き換えます）:

```json
{
  "openid:openid-connect-core-1_0": {
    "status": "confirmed",
    "url": "https://openid.net/specs/openid-connect-core-1_0.html",
    "rev": "1_0",
    "sha256": "<確認に用いた本文のSHA-256・小文字64桁>",
    "title": "OpenID Connect Core 1.0",
    "reason": "<原文を確認した上での、認証・認可との関連理由>",
    "reviewedAt": "<確認日時。例: 2026-11-12T12:00:00+09:00>",
    "reviewedBy": "<原文の確認主体。AIの場合の例: OpenAI Codex（AI）>"
  }
}
```

`rev`には収集側の`revision`をそのまま設定します。キーの文書名とURLは一致させます。`reviewedAt`はタイムゾーン付きのISO日時です。`reviewedBy`は既存記録との互換性のため省略できますが、新規記録には確認主体を記載します。AIの原文確認を人による原文確認と誤認させないよう、Pagesにもその値を表示します。ハッシュ・理由・日時などが不足したOpenID記録はPagesビルドでエラーになります。

`confirmed`のタイトルと理由はPagesに表示されます。掲載を抑制する場合は、理由と同じ対象版・ハッシュを記録して`status`を`excluded`にします。

## 更新時の表示

| 状態 | Pages |
| --- | --- |
| 人の記録なし | 公式一覧掲載・未確認 |
| URL・版・本文ハッシュがすべて一致したconfirmed | 確認済み |
| URL・版・本文ハッシュがすべて一致したexcluded | 一覧から抑制 |
| 記録はあるが版やハッシュが不一致、または本文ハッシュが不明 | 再確認待ち。以前の理由・確認日時を表示 |
| 別のURL・文書名で出た新版 | 独立した未確認文書。旧版の確認を流用しない |
| 公式一覧から消えた文書 | 一覧には表示しない。確認記録は保持 |

ハッシュが同じなら、日次取得の日時・ETag・掲載タイトルが変わっても再確認待ちにはしません。比較対象は最後に取得した本文です。本文の巡回前に起きた変更を先に検知するものではありません。

再確認後は、同じキーの`rev`・`sha256`・理由・`reviewedAt`を更新するPRを作ります。以前の対象外判定も、本文が変われば掲載を復帰させて再確認待ちにします。確認記録自体は自動で書き換えません。

## IETF仕様

既存の形式を使用します。キーは `rfc7636` や `draft-...`、値は `status`・`rev`・`title`・`reason` です。RFCの`rev`は空文字、Internet-Draftは確認した改訂番号を指定します。OpenID用のハッシュ・日時の必須条件は既存IETF記録には適用しません。

## ローカル検証

```sh
npm run test:pages
npm run build:pages
```

この変更では登録の仕組みと表示を追加しています。既存のOpenID仕様を一括で確認済みにはしていません。

## 個別の確認メモ

- [OpenID Connect Core / Discovery（2026-11-12、OpenAI Codexによる原文確認）](review-notes/openid-core-discovery-2026-11-12.md)
- [FAPI 2.0 Security Profile / Attacker Model（2026-11-12、OpenAI Codexによる原文確認）](review-notes/fapi2-security-profile-attacker-model-2026-11-12.md)
- [FAPI 1.0 Baseline / Advanced（2026-11-12、OpenAI Codexによる原文確認）](review-notes/fapi1-baseline-advanced-2026-11-12.md)
