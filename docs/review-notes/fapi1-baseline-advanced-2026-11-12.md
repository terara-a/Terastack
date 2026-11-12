# FAPI 1.0 Baseline / Advanced の原文確認

確認日: 2026-11-12（日本時間）  
原文の確認主体: OpenAI Codex（AI）  
確認記録の日時: `2026-11-12T08:08:04Z`

認証・認可との関連性を原文の該当節で確認し、FAPI 1.0の2仕様をカタログへ採用するためのメモです。採用は、この記録を含むPRの人によるレビュー・マージで決定します。旧版も関連性の確認対象に含めますが、この記録は新規実装での採用推奨、全条項への適合性認証、実装監査を意味しません。

## 対象版と本文ハッシュ

2件とも公式一覧の公開段階と本文はFinal、カタログの版は`1_0`です。

| 対象 | SHA-256 | 取得日時（UTC） |
| --- | --- | --- |
| Part 1: Baseline | `2c5da4e50fae5157c397f4e2a522dc4007a71207d1715064ca305bd5985b1a32` | 2026-11-12T08:04:35Z |
| Part 2: Advanced | `72e559bee9e8841f3819df26400b72164a38577ed75badbde605b1592ce90fe7` | 2026-11-12T08:04:43Z |

収集データではこの2件の本文ハッシュが未取得だったため、同じPRで実取得したハッシュ・HTTPメタデータ・本文確認日時を追記しました。一覧全体の成功チェックポイントは進めていません。

robots.txtを確認し、既存の初回ランダム待機と各要求の間隔を守って、robots.txtと本文2件の計3要求で取得しました。本文は一時領域に保存し、Gitには追加しません。

## Part 1: Baseline の確認根拠

対象: [Financial-grade API Security Profile 1.0 - Part 1: Baseline](https://openid.net/specs/openid-financial-api-part-1-1_0.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Scope](https://openid.net/specs/openid-financial-api-part-1-1_0.html#scope) | OAuthトークンの取得、OpenID Connectによる利用者の識別、保護データへのアクセスを扱う。 |
| [§5.2.2 Authorization Server](https://openid.net/specs/openid-financial-api-part-1-1_0.html#authorization-server) | PKCE S256、登録済みredirect_uriとの厳密な一致、利用者認証・認可、コードの再利用禁止、発行するトークン等の条件を定義する。 |
| [§5.2.2.1 Returning Authenticated User's Identifier](https://openid.net/specs/openid-financial-api-part-1-1_0.html#returning-authenticated-user-s-identifier) | 利用者の識別子をトークン応答で提供する場合のOIDC処理と、openid scopeを要求した場合のID Token発行を規定する。 |
| [§5.2.3 Public Client](https://openid.net/specs/openid-financial-api-part-1-1_0.html#public-client) / [§5.2.4 Confidential Client](https://openid.net/specs/openid-financial-api-part-1-1_0.html#confidential-client) | 公開クライアントのPKCE・CSRF対策等と、機密クライアントに追加される認証・鍵の要件を定義する。 |
| [§6.2.1 Protected Resources](https://openid.net/specs/openid-financial-api-part-1-1_0.html#protected-resources-provisions) | 期限・失効・scopeと対象主体を照合し、アクセストークンに対応する保護リソースだけを返す条件を定義する。 |

判定: トークン取得・利用者認証・認可と保護リソースでの権限検証を扱うため、対象ハッシュに限定して`confirmed`を提案します。

## Part 2: Advanced の確認根拠

対象: [Financial-grade API Security Profile 1.0 - Part 2: Advanced](https://openid.net/specs/openid-financial-api-part-2-1_0.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Scope](https://openid.net/specs/openid-financial-api-part-2-1_0.html#scope) | より高リスクな保護データへのアクセスに向けた、トークン取得・OIDCによる識別・API利用を扱う。 |
| [§5.1.1 ID Token as Detached Signature](https://openid.net/specs/openid-financial-api-part-2-1_0.html#id-token-as-detached-signature) / [§5.1.2 JARM](https://openid.net/specs/openid-financial-api-part-2-1_0.html#jwt-secured-authorization-response-mode-for-oauth-2-0-jarm) | ID Tokenを使う分離署名と、JWTで認可応答を保護するJARMの選択肢を定義する。JARMはOAuth単独でも利用でき、利用者の識別情報を伝える処理と応答の保護を区別している。 |
| [§5.2.2 Authorization Server](https://openid.net/specs/openid-financial-api-part-2-1_0.html#authorization-server) | 署名付きJWTリクエスト、送信者制約付きアクセストークン、MTLS、認可応答の保護等を規定し、公開クライアントはサポートしない。 |
| [§5.2.3 Confidential Client](https://openid.net/specs/openid-financial-api-part-2-1_0.html#confidential-client) | 署名付きリクエストへのパラメーター格納、aud・exp・nbf、MTLS、PAR使用時のPKCE S256等を規定する。 |
| [§6.2.1 Protected Resources](https://openid.net/specs/openid-financial-api-part-2-1_0.html#protected-resources-provisions) | Baselineの保護リソース要件を引き継ぎ、MTLSの要件を追加する。 |

判定: 認可要求・応答の保護、トークンの送信者制約、保護リソースの要件を扱うため、対象ハッシュに限定して`confirmed`を提案します。

## 版ごとの条件

Baselineは公開クライアントを扱いますが、Advancedは公開クライアントをサポートしません。また、Advanced §5.2.2と§5.2.3はBaselineのRFC 7636要件を例外扱いにしつつ、PAR使用時はPKCE S256を要求します。従って「FAPI 1.0 Advancedは全ての場合でPKCEを必須にする」とは記録しません。

これらはFAPI 2.0と要件が異なる1.0の原文を確認した記録です。既存のPKCEデモをいずれかのFAPIプロファイルに準拠と認定する変更や、サンプル実装・分類ルールの変更は行いません。
