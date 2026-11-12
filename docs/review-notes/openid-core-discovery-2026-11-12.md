# OpenID Connect Core / Discovery の原文確認

確認日: 2026-11-12（日本時間）  
原文の確認主体: OpenAI Codex（AI）  
確認記録の日時: `2026-11-12T07:03:01Z`

このメモは、認証・認可への関連性を原文の該当節で確認し、カタログへの採用を提案するものです。仕様の全条項への適合性評価や、実装のセキュリティ監査は行っていません。採用はこの記録を含むPRの人によるレビュー・マージで決定します。

## 対象と取得結果

2件とも公式一覧ではFinal、本文のタイトルは「1.0 incorporating errata set 2」です。カタログの`revision`は`1_0`で、同じURLの本文変更も区別できるよう取得した元のHTMLバイト列のSHA-256を記録しました。

| 対象 | SHA-256 | 取得日時（UTC） |
| --- | --- | --- |
| Core | `4d016752a645e8a3c259baa4173b5a90cb6c82898ce868fc8444adde262a5aed` | 2026-11-12T06:59:14Z |
| Discovery | `0401a07b35de50e914e195aa2c3c64cc4f6542464381c885d24a2623fbf75ec2` | 2026-11-12T06:59:23Z |

robots.txtの許可を確認し、通常と同じ初回のランダム待機・取得間隔を適用しました。HTTP要求はrobots.txtと本文2件の計3件で、並列取得や追加の全文再取得は行っていません。本文は検証環境の一時領域に保存し、Gitには追加していません。

元の収集データではこの2件の本文が未取得だったため、同じPRで対象2件だけにハッシュ・ETag・Last-Modified・本文確認日時を追記しました。一覧全体の成功日時は進めていません。

## Core の確認根拠

対象: [OpenID Connect Core 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Introduction](https://openid.net/specs/openid-connect-core-1_0.html#Introduction) | OAuth 2.0の上に利用者の認証を追加し、ID Tokenとクレームで認証結果・利用者情報を伝える仕様である。 |
| [§2 ID Token](https://openid.net/specs/openid-connect-core-1_0.html#IDToken) | 認証に関するJWTの構造と、iss・sub・aud・exp・nonce等のクレームを定義する。 |
| [§3.1.1 Code Flow Steps](https://openid.net/specs/openid-connect-core-1_0.html#CodeFlowSteps) / [§3.1.2.4 Consent](https://openid.net/specs/openid-connect-core-1_0.html#Consent) | 利用者の認証と認可判断、認可コード発行・交換、ID Tokenの検証という一連の流れを定義する。 |
| [§3.1.3.7 ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) | issuerとの厳密一致、audience、署名等の検証、期限、要求したnonceの照合など、認証結果を受け入れる条件を定義する。 |
| [§5.3 UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo) | Access Tokenでアクセスする保護リソースから、認証した利用者のクレームを取得する。 |

判定: 認証・認可に直接関連するため、上記本文ハッシュを対象に`confirmed`を提案します。

## Discovery の確認根拠

対象: [OpenID Connect Discovery 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-discovery-1_0.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Introduction](https://openid.net/specs/openid-connect-discovery-1_0.html#Introduction) | Providerの発見と、そのOAuth 2.0エンドポイントを含む設定文書の取得を扱う。 |
| [§3 Provider Metadata](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata) | issuer・authorization_endpoint・token_endpoint・jwks_uri等を定義し、認証処理と鍵の検証に必要な構成情報を提供する。 |
| [§4.1 Configuration Request](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationRequest) | Issuer URLに基づく`/.well-known/openid-configuration`の取得を定義する。 |
| [§4.3 Configuration Validation](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation) | 取得元Issuer URL、設定内issuer、ID Token内issの一致と、不正な設定を利用しない条件を定義する。 |
| [§7.1 TLS](https://openid.net/specs/openid-connect-discovery-1_0.html#TLSRequirements) / [§7.2 Impersonation](https://openid.net/specs/openid-connect-discovery-1_0.html#Impersonation) | TLSの証明書検証とissuer一致によって、攻撃者のエンドポイントや鍵を信頼させるなりすましを防ぐ。 |

判定: 認証構成の発見と信頼する発行者の検証に直接関連するため、上記本文ハッシュを対象に`confirmed`を提案します。

## 適用範囲

確認済み表示は、登録したURL・版・本文ハッシュの一致に限定します。別URLの新版や本文変更は、既存の仕組みに従って未確認または再確認待ちになります。このPRでOIDCのサンプル実装や既存PKCEデモの適合性を確認・変更したものではありません。
