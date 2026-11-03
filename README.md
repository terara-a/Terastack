# Terastack

認証・認可の標準を追跡するカタログと Cloudflare Workers 用サンプル。

## 開発

Node.js 24 以上。既存チェックアウトを使用します。

```sh
npm test
npm install
npm run dev
```

`POST /examples/pkce` に JSON `{"verifier":"43〜128文字のRFC 7636 verifier"}` を送ると S256 challenge を返します。RFC 7636 Appendix B のベクトル、入力拒否、HTTP 応答をテストします。これは認可サーバーではなく、仕様の一部分の学習用サンプルです。秘密値を送信せず、ローカルで利用してください。

Workers の Fetch / Web Crypto のみを利用します。`wrangler.jsonc` を使って将来 Workers にデプロイできます。現在のテストは Node の Web API によるもので、workerd 上での検証や Cloudflare へのデプロイはまだ実施していません。

## 新しい規格の発見

```sh
npm run collect
FULL_SCAN=true npm run collect
```

Datatracker `/api/v1/doc/document/?type=draft&limit=100` と `type=rfc` の全ページを取得します。入口にキーワードや WG フィルターを置かず、未知の名称も保存します。初回は既存 RFC・ドラフトも全件取得します。通常は `time__gte` と前回成功から3日の重複期間で差分取得し、日曜日には全件再照合します。文書名とリビジョンで識別し、同一版の状態更新も time の変更として検出します。ページング失敗、APIスキーマ不一致、分類失敗では成功時刻を進めません。

分類は OpenAI 互換の Chat Completions API を使用します。実行環境または GitHub Actions に次を設定してください。

- `CLASSIFIER_URL`: HTTPS の chat/completions エンドポイント
- `CLASSIFIER_MODEL`: モデル名
- `CLASSIFIER_API_KEY`: 秘密情報。Actions Secrets に登録し、Git に保存しない

概要の意味から「同一性の確認」「権限の付与・委譲」「資格情報」「アクセス判断」への関連を判定します。文書は命令として扱いません。未設定時や判断が不確かな場合は `relevant: null` としてレビュー対象に残します。関連なし判定も削除せず保存します。分類器未設定でも全件収集できますが、関連性判定は完了しません。

`catalog/state.json` に観測メタデータと分類理由、`reports/daily/` に変更したリビジョンを保存します。未マージの日次ブランチを引き継ぎ、収集済み状態の消失を防ぎます。Actions で PR 作成を許可してください。毎日 22:23 UTC（日本時間翌日07:23）に実行します。定期実行には遅延があります。

## 現在の範囲と次の段階

実装済み: RFC・ドラフトの全件/差分発見、意味による概要分類、未判定レビューキュー、日次カタログ PR、PKCE サンプル。

未実装: 公式本文の版別保存・ハッシュ、節単位差分、RFC Editor の Updates/Obsoletes/Errata の照合、参照先探索、低関連判定の定期再分類、JWT/DPoP サンプル、LLM による日次のコード生成。現状の日次 PR はカタログ更新であり、サンプル実装の自動生成ではありません。これらは収集の実地検証後に拡張します。

分類の網羅性は保証できません。既知の検索語に限定しない収集により、未知の規格もレビュー可能な状態に残す構成です。実 API 取得・Workers 実行・分類モデル接続はそれぞれ独立して検証が必要です。
