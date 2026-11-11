# 有料APIを必須にしない候補抽出

既定のGHAはfastembedとBAAI/bge-small-en-v1.5をCPUで実行します。OpenAI等のキー・残高は不要です。公開リポジトリの標準GHAランナーを前提とし、GitHubの利用条件・実行時間・モデルダウンロードの制限は別途あります。モデルのライセンスはMITです。初回のバイナリはfastembedの対応する公式配布元から取得し、TLS検証を維持します。

## 使い方

「Daily standards discovery」のRun workflowで:

- `evaluate`: 50件の評価。26件がしきい値調整用、24件が独立検証用。
- `backfill`: 初回データを分割処理。既定2,000件/実行。limitで件数変更。完了結果は64件ごとに保存し、次回は既処理フィンガープリントをスキップします。
- `daily`: 収集後、新規・更新を最大200件優先し、残りの枠で既存分を処理。

モデルと評価セットの変更時は再評価し、検証用データの再現率90%以上・適合率50%以上でなければ候補抽出を停止します。しきい値は調整用の正例からのみ決め、検証用ラベルを調整に使いません。評価失敗時はreports/semantic/evaluation.jsonを見て、対象範囲・例・モデルを見直します。50件の人手作成概要は回帰評価用で、公式概要の引用でも全件精度の保証でもありません。疑似文書も含みます。

## 保存と掲載

- catalog/reviewed.json: PRで人が確認する仕様。confirmedで掲載、excludedで候補を抑制。初期8件のRFCもこのPRの確認対象です。ドラフトの確認は指定版だけに有効。
- catalog/candidates.json: しきい値以上の関連候補。タイトル・版・時刻・スコア・理由だけ保持。人が確認したとは扱わない。
- catalog/semantic-index.json: 文書名→本文概要のハッシュ・スコア・版・時刻。本文とベクトルはGitに保存しない。
- reports/semantic/progress.json: 進捗と低スコアから最大20件の再現可能な監査サンプル。

Pagesは確認済みと未確認候補を別表示します。低スコアは「無関係」にせず、索引に残して監査サンプルや後のモデル変更で再検討します。候補を確認したらreviewed.jsonに版と理由を記録しPRでレビューしてください。改訂されたドラフト候補は再計算まで掲載から外します。

## 制約と評価

モデルは入力を最大トークン長で切り詰めます。長い概要は後半が評価されないため、重要文書は本文を人が確認してください。埋め込みの意味距離だけで認証・認可との関係は保証できません。候補数、見落とし、監査サンプルを継続的に確認します。

初回は全件のメタデータをページングして未処理分を探します。分割実行のたびに既処理のメタデータを再取得するので、APIの負荷・実行時間は計測して調整してください。新規・更新の優先処理も公式メタデータを取得します。モデルファイルだけをActions cacheに保存し、進捗はPRのデータから引き継ぎます。

ローカル検証:

```sh
python3 -m venv .venv-semantic
.venv-semantic/bin/pip install -r semantic/requirements.txt
.venv-semantic/bin/python semantic/pipeline.py --mode evaluate
python3 -m unittest discover -s semantic -p 'test_*.py'
```

従来の有料APIを明示的に使う場合だけVariablesにCLASSIFICATION_ENGINE=apiを設定します。既定はlocalで、モデルAPIのSecretも渡しません。分類器の切替に関係なく既存の有料台帳は残します。
