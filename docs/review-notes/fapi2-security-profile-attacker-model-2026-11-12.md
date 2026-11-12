# FAPI 2.0 Security Profile / Attacker Model の原文確認

確認日: 2026-11-12（日本時間）  
原文の確認主体: OpenAI Codex（AI）  
確認記録の日時: `2026-11-12T07:55:05Z`

認証・認可に関連する仕様としてカタログに採用するため、原文の該当節を確認したメモです。採用はこの記録を含むPRの人によるレビュー・マージで決定します。仕様の全条項への適合性評価、実装監査、形式検証の独立した再実行は行っていません。

## 対象版と本文の照合

2件とも公式一覧の公開段階はFinal、カタログの版は`2_0`です。原文を新たに取得し、元のHTMLバイト列のSHA-256を収集済みのハッシュと照合しました。

| 対象 | SHA-256 | 今回の取得日時（UTC） |
| --- | --- | --- |
| Security Profile | `26a49ad19b1f2b19ecc1cd9b825b4d5012f5e03a5dc8cb0dbd26462d39da465c` | 2026-11-12T07:52:39Z |
| Attacker Model | `0de77b6f449ec5f80cab8d51d24f46cfeb02159dd08288fded6aee0588b2ff18` | 2026-11-12T07:52:46Z |

ハッシュは2件とも収集済みデータと一致しました。FAPI 2.0の収集記録は変更せず、確認済みの記録だけを追加します。原文は一時領域に保存し、Gitには追加しません。

robots.txtを確認し、既存と同じ初回ランダム待機とリクエスト間隔を守りました。要求はrobots.txtと本文2件の計3件で、並列取得や確認のための再取得は行っていません。

## Security Profile の確認根拠

対象: [FAPI 2.0 Security Profile](https://openid.net/specs/fapi-security-profile-2_0-final.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Scope](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-1) / [§5.1.1 Introduction](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.1.1) | OAuth 2.0を用い、機密クライアントへのトークン発行と、保護リソースへのアクセスを安全に行うためのプロファイルである。公開クライアントはこの文書の適用範囲に含まれない。 |
| [§5.3.2.1 Authorization Server General Requirements](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.2.1) | MTLS/DPoPによる送信者制約付きアクセストークンと、MTLS/private_key_jwtによるクライアント認証などを要求する。 |
| [§5.3.2.2 Authorization Endpoint Flows](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.2.2) / [§5.3.3.2 Authorization Code Flow](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.3.2) | 認可コードフロー、クライアント認証付きPAR、PKCE S256、認可応答のissuer検証などを規定する。 |
| [§5.3.3.1 Client General Requirements](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.3.1) / [§5.3.4 Resource Servers](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.4) | クライアントによる信頼できるメタデータの利用と、リソースサーバーによるトークンの有効性・完全性・期限・失効・権限・送信者制約の検証を定義する。 |
| [§5.3.2.3 Returning Authenticated User's Identifier](https://openid.net/specs/fapi-security-profile-2_0-final.html#section-5.3.2.3) | トークン応答で認証した利用者の識別子を提供したい場合にOpenID Connectをサポートするという条件を明記する。FAPIの全利用で利用者認証を必須にする記述とは区別する。 |

判定: トークン発行、認可フロー、クライアント認証、保護リソースでの権限確認を規定するため、認証・認可に直接関連する仕様として`confirmed`を提案します。

## Attacker Model の確認根拠

対象: [FAPI 2.0 Attacker Model](https://openid.net/specs/fapi-attacker-model-2_0-final.html)

| 節 | 原文から確認した内容 |
| --- | --- |
| [§1 Scope](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-1) | FAPI 2.0の安全性目標、攻撃者の役割・能力、前提条件と限界を扱う。 |
| [§5.2 Authorization](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-5.2) / [§5.3 Authentication](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-5.3) | 他者の保護リソースへのアクセスを防ぐ目標と、OpenID Connect使用時に他者としてログインすることを防ぐ目標を区別する。 |
| [§5.4 Session Integrity](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-5.4) | 攻撃者のアカウントでのログインやリソース利用を利用者に強制する、CSRF・セッションすり替え等に関する目標を定義する。 |
| [§6 Attacker Model](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-6) / [§7 Attackers](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-7) | Web・ネットワーク攻撃者、認可要求やリソース要求の漏洩等を扱い、TLS・鍵配布・端末・セッション管理等に関する前提を示す。 |
| [§8.5 Implementation Errors](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-8.5) / [§9 Formal Analysis](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-9) | 形式モデルでの分析と実装上の脆弱性を区別し、形式分析がこの文書の安全性目標・攻撃者モデルに基づくことを説明する。 |

なお、[§7.6のA4](https://openid.net/specs/fapi-attacker-model-2_0-final.html#section-7.6)はFAPI 1.0で考慮したトークンエンドポイント差替えの参考情報です。FAPI 2.0では信頼できるメタデータからのエンドポイント取得を要求するため、この攻撃者は対象として該当しない旨が明記されています。全ての役割を現在のFAPI 2.0に同じ条件で適用する読み方はしていません。

判定: 認可・認証・セッション完全性に関する目標と攻撃者モデルを定義し、Security Profileの前提を理解するために直接関連する仕様として`confirmed`を提案します。

## 確認の範囲

この記録は取得したURL・版・本文ハッシュに限定します。本文が変われば再確認待ちになります。既存の公開クライアントを模したPKCEデモをFAPI準拠と認定したものではなく、サンプル実装や分類ルールの変更も含みません。
