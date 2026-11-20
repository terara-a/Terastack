# Ephemeral Subject Identifier のサンプル

- [デモ](https://terara-a.github.io/Terastack/samples/ephemeral-subject/)
- [サンプルコード](https://terara-a.github.io/Terastack/samples/ephemeral-subject/code.html)
- [仕様原文](https://openid.net/specs/openid-connect-ephemeral-subject-identifier-1_0.html)

2026-10-07公開のFinal仕様を対象にしています。RPに永続的な利用者アカウントを作らず、資格を確認してその回の閲覧を許可する設計を考えるための、ブラウザ内シミュレーションです。

## 仕様との対応

| 仕様の節 | サンプル |
| --- | --- |
| §4 Ephemeral Identifier | 認証要求ごとに新しいsubを発行。32バイトのWeb Crypto乱数をbase64urlにし、ページ内OPの発行履歴で再利用を拒否 |
| §5 Discovery Metadata | `subject_types_supported`に`ephemeral`を含むメタデータを表示 |
| §6 Client Registration | RP登録の`subject_type`で指定。認証要求に独自のsubject_typeパラメーターを送らない |
| §7 Security Considerations | 乱数候補が衝突した場合は再試行し、繰り返す場合は失敗。時刻・連番・Math.randomには依存しない |
| §8 Privacy Considerations | public/pairwise/ephemeralを比較し、固定emailやCookieがあればsub以外で照合できることを表示 |

`protocol.js`がOPとRPの処理、`client.js`が表示と操作を担当します。同じ架空のOP利用者で再度認証要求を行います。新しい認証要求ではephemeralのsubが変わりますが、発行済みアクセストークンでUserInfoを取得してもsubは変わりません。ID TokenとUserInfoには同じ認証要求に束縛したsubを返します。

認可要求でcode challenge・state・nonceを送り、コードをclient_id・redirect_uri・verifierに束縛します。コード交換後にRS256の署名、issuer、audience、nonce、期限を検証し、UserInfoのsub一致を確認します。state不一致時はコード交換を行いません。コードは5分、アクセストークンは10分で期限切れになります。

## 比較とユースケース

- publicは同じOPの利用者に同じsubを返します。
- pairwiseはsectorと利用者ごとにsubを保持します。デモのRP A/Bは別sectorです。同じsectorの複数クライアントでは同じsubになり得ます。
- ephemeralは認証要求ごとにsubを新規発行します。ページ遷移やUserInfo取得ごとに変えるという意味ではありません。

年齢ゲートは**架空の属性を使ったアプリ側の例**です。`age_over_18`と`age.demo`はデモ独自のクレーム・scopeで、この仕様は年齢確認の方法や年齢を保証するクレームを定義しません。架空のminor利用者は認証できても、閲覧は許可されません。

デモのCookieは観察用の値で、実際のブラウザCookieやLocal Storageを設定しません。emailも架空の`.invalid`ドメインです。いずれも有効にした場合だけ表示記録に含めます。比較表示はsub・email・RP Cookieの値だけであり、他の属性や通信情報からの追跡可能性を判定するものではありません。

同じ値を照合できないことと、完全な匿名性は異なります。固定属性やCookieを渡せば照合でき、OP側では利用者が分かっています。一人一回の制限、継続する利用履歴、既存アカウントの紐付けは別の設計が必要です。

## 実運用との境界

プロトコルの要求はネットワークへ送信しません。OPの秘密鍵もRPの検証処理も同じブラウザ内にあり、独立した信頼境界を提供しません。表示するURLは説明用で、公開エンドポイントではありません。実ログイン、実際の年齢属性の保証、クライアント登録の認可・sector_identifier_uriの検証、鍵管理、暗号化ID Token、refresh tokenは実装していません。JWT検証もこのモデルが発行する形式の範囲で、汎用のJWT検証ライブラリではありません。

OPの発行履歴・public/pairwiseの対応表・鍵・コード・トークンはページ内のメモリーだけに保持し、リセットや再読み込みで消えます。本番では識別子の非再利用を保つため、再起動・複数プロセスをまたぐ生成と履歴の整合、衝突検出、永続化や鍵管理が必要です。Web Cryptoの32バイト乱数は推測確率の目標を満たすための選択であり、サーバー全体の適合性を保証するものではありません。

## 実行と検証

```sh
npm ci
npm run test:ephemeral
npm run build:pages
python3 -m http.server 8000 --directory dist
```

`http://localhost:8000/samples/ephemeral-subject/`を開きます。テストでは識別子の再利用拒否・sectorごとの安定性・UserInfoの一致・コードの再利用と並行交換・state/nonce/署名/issuer/audience/期限・年齢属性と認証の区別を確認します。
