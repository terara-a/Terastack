# Terastack

認証・認可に関係する RFC・Internet-Draft を追跡し、関連仕様とサンプル実装を蓄積するリポジトリです。

**公開ページ：<https://terara-a.github.io/Terastack/>**

## 現在の運用

GitHub Actions で全件のメタデータを収集し、CPU 上の小型埋め込みモデルで関連候補を抽出します。収集の入口を検索語や WG で絞らないため、未知の規格名も対象になります。既定の処理にモデル API のキーや課金設定は不要です。GHA の実行時間・利用枠とモデル配布元への通信は必要です。

Pages では次を区別します。

- **確認済み**：`catalog/reviewed.json` に記録された仕様。
- **関連候補**：機械が意味の近さから抽出した、関連性が未確認の文書。
- **未確認**：人の確認が済んでいない文書。低スコアでも「無関係」とは断定しません。

全候補をレビューする必要はありません。実装したい仕様を選ぶ時に、原文・対象版・現在の更新／廃止関係を確認します。気になる誤検出だけ個別に除外できます。

成功した収集ジョブは生成データだけの PR を検証し、自動マージして Pages を更新します。コード・抽出ルール・評価用データ・人の確認結果は自動マージしません。

## GitHub Actions の実行方法

[Actions](https://github.com/terara-a/Terastack/actions) → **Daily standards discovery** → **Run workflow** を開き、通常はブランチを **main** にします。

### 初回分を進める

```text
mode: backfill
limit: 2000
max_usd: 空欄
```

既定の無料 CPU モデルで、未処理・更新された文書を最大2,000件処理します。処理済みのフィンガープリントをスキップするため、同じ指定で繰り返し実行できます。既存の未マージデータも引き継ぎます。

少量の動作確認なら、次の指定にします。自動マージ・公開までの確認にも使用した設定です。

```text
mode: backfill
limit: 64
max_usd: 空欄
```

### 引数一覧

| 引数 | 指定値 | 既定の CPU 処理での意味 |
| --- | --- | --- |
| `mode` | `evaluate` | 小規模な精度評価だけを実行。手動実行画面の既定値 |
| `mode` | `backfill` | 既存文書の候補抽出を分割して進める |
| `mode` | `daily` | メタデータ収集後、新規・更新を優先して候補抽出 |
| `mode` | `models` | 従来のモデル API の一覧確認。ローカル候補抽出には不要 |
| `limit` | 正の整数、または空欄 | `daily` / `backfill` の最大処理件数。空欄なら **2,000件** |
| `max_usd` | 空欄でよい | 有料 API 用の累積予約額上限。CPU 処理では使用しない |

`evaluate` は文書の初回分を進めません。初回処理には `backfill` を選んでください。モデルや評価セットが変わると、候補抽出前に必要な評価を自動実行します。

日次の定期実行は **日本時間7:23（22:23 UTC）**、`daily` モードです。GitHub 側の都合で開始が遅れる場合があります。新規・更新文書を最大200件優先し、残りの枠で既存の未処理分を進めます。

### 結果の見方

1. Actions が成功したか確認します。
2. `reports/semantic/progress.json` の `processed`（今回）、`screened`（累計）、`total`（索引全件）、`candidates`（候補数）で進捗を確認します。
3. データの自動マージ後、**GitHub Pages** の公開成功を確認します。
4. Pages で候補を検索します。全件の確認作業は不要です。

低スコア文書から最大20件の `lowScoreAuditSample` も保存します。見落としを点検する時に使えます。小規模評価の結果は `reports/semantic/evaluation.json` にあり、全件の精度を保証するものではありません。

収集・抽出・検証が失敗した場合は自動マージせず、PR や復旧用 artifact を残します。失敗したステップと保存されたレポートを確認してください。

## 自動反映と人の確認

自動マージは、同一リポジトリの GitHub Actions bot による `standards/daily` → `main` の生成データ PR が対象です。許可した JSON ファイル、形式、Pages ビルドを検証し、検査したコミット SHA を指定して通常のマージ API でマージします。PR 由来のコードは実行しません。

次の変更は人のレビューが必要です。

- コード・ワークフロー・モデルや抽出設定
- 評価用データ
- `catalog/reviewed.json` の確認済み／対象外判定
- 許可外のファイル、削除、シンボリックリンクを含む変更

ブランチ保護は回避しません。保護ルールや権限がマージを拒否した場合は PR を残します。GitHub の予約型 auto-merge 設定や追加 PAT は不要です。`GITHUB_TOKEN` によるマージでは push ワークフローが起動しないため、Pages は明示的に起動します。

個別の確認結果は `catalog/reviewed.json` に版と理由を記録します。`confirmed` は確認済み、`excluded` は候補掲載の抑制です。似た文書の判定を自動学習するものではありません。ドラフトの確認結果は指定した版にだけ適用します。

詳細は [ローカル候補抽出](docs/local-semantic.md) を参照してください。

## 保存データ

| 保存先 | 内容 |
| --- | --- |
| `catalog/state.json` | 全件の軽い索引。版・更新日時などを保持 |
| `catalog/reviewed.json` | 人が確認する仕様と個別の対象外判定 |
| `catalog/candidates.json` | 未確認の関連候補。タイトル・版・スコアなど |
| `catalog/semantic-index.json` | 処理済み文書のフィンガープリントとスコアなど |
| `reports/daily/` | メタデータ収集で索引に変更があった実行の集計 |
| `reports/semantic/` | CPU モデルの評価・進捗・監査サンプル |
| `catalog/related.json`、`reports/evaluation/`、`reports/classification/` | 従来の API 分類の結果。既定の CPU 処理とは別 |
| `catalog/classification-budget.json` | 従来の有料 API の累積予約台帳。実際の請求額ではない |

概要・本文・埋め込みベクトルの全件複製は Git に保存しません。RFC は最大番号だけを取得境界にせず、番号順と公開順の違いによる取りこぼしを避けます。ドラフト収集は通常3日の重複期間を含む差分取得で、UTC の日曜日には全件照合します（定期実行では日本時間の月曜日）。

旧形式の移行は `node collector/migrate.ts` で行えます。現在のファイルは軽量化されていますが、過去の大きなデータは Git 履歴に残ります。

## 開発とローカル実行

Node.js 24 以上。CPU 候補抽出には Python 3.12 を使用します。既存チェックアウトで実行してください。

```sh
npm ci
npm test
npm run test:pages
npm run test:merge-catalog
python3 -m unittest discover -s semantic -p 'test_*.py'
```

モデルをダウンロードして CPU 候補抽出を実行する手順は [ローカル候補抽出](docs/local-semantic.md) にあります。収集だけなら次で実行できます。

```sh
npm run collect
FULL_SCAN=true npm run collect
```

### Pages

```sh
npm run build:pages
python3 -m http.server 8000 --directory dist
```

`site/` が HTML/CSS/JavaScript、`scripts/build-pages.ts` が公開用スナップショットの生成処理です。`dist/` の静的ファイルだけを配信し、全件索引・費用台帳・キー・生の API 応答は配信しません。相対パスのため `/Terastack/` のプロジェクトページでも動きます。

新しいリポジトリで公開する場合は **Settings → Pages → Source = GitHub Actions** に設定します。コード PR ではビルドだけを検証し、main へのマージ後に公開します。手動で再公開する場合は **GitHub Pages** を main で実行します。

### Workers サンプル

```sh
npm run dev
```

`POST /examples/pkce` に JSON `{"verifier":"43〜128文字のRFC 7636 verifier"}` を送ると S256 challenge を返します。学習用のサンプルで、認可サーバー全体の実装ではありません。Pages にも入力を外部送信せず計算する PKCE デモがあります。

Workers 版は Fetch / Web Crypto を使用します。Cloudflare へのデプロイや workerd 上での実動作検証は未実施です。

## 有料 API を明示的に使う場合

Variables に `CLASSIFICATION_ENGINE=api` を設定した場合だけ、従来のモデル API 分類を使用します。キー・モデル・単価・累積予約額の設定は [API 分類の運用手順](docs/classification.md) を参照してください。通常の運用では設定不要です。

## 未実装の範囲

仕様本文の版別保存・節単位の差分、RFC の更新／廃止関係や正誤表の自動照合、確認結果からの自動学習、JWT/DPoP 等の追加サンプル、日次のサンプルコード生成は未実装です。現状は仕様の発見・候補抽出・閲覧と PKCE サンプルまでを提供します。
