# SSF / CAEP / RISC / CAEP Interoperability Profile の原文確認

確認日: 2026-11-24（日本時間）  
原文の確認主体: OpenAI Codex（AI）  
確認記録の日時: `2026-11-23T16:05:52Z`

この記録は、認証・認可への関連性を原文の該当節で確認し、URL・版・本文ハッシュを照合した結果です。既存のカタログの「確認済み」への登録を提案し、採用は人によるPRレビュー・マージで決定します。SSF実装や相互運用性の試験、仕様の全要件への適合性認証を実施した意味ではありません。

## 対象と照合

| 仕様の本文タイトル | 公開段階 / カタログ版 | SHA-256 | 原文取得日時（UTC） |
| --- | --- | --- | --- |
| OpenID Shared Signals Framework Specification 1.0 | Final / 1_0 | `240e1567017d628d835fa61f0c1cc75f566605f3decaa26a6742c33f7ecd4f16` | 2026-11-23T15:57:09Z |
| OpenID Continuous Access Evaluation Profile 1.0 | Final / 1_0 | `46337de47b7433b09008395896310cb0ed356e66abb4f99b33d2a31045a75931` | 2026-11-23T15:57:16Z |
| OpenID RISC Profile Specification 1.0 | Final / 1_0 | `2ab71f4e67a348d371ab0609bf5bd9c5d8b28a041ab69117965aa96ea5f965dd` | 2026-11-23T15:57:24Z |
| CAEP Interoperability Profile 1.0 - draft 00 | Implementer's Draft / 1_0 | `92e4a3fcdafce87a2e37eec1c6acfc437a794bc8c8ae734dca7ec45804cf4bd2` | 2026-11-23T15:57:31Z |

直前の調査で公式サイトから間隔を空けて取得した原文4件を再利用し、4件とも最新mainの収集済みハッシュと一致しました。今回、提供元への追加アクセス、収集データや成功チェックポイントの変更は行っていません。HTML本文は検証環境の一時領域に保持し、Gitには追加しません。

SSF・CAEP・RISCはFinal版だけを対象とし、旧Draftの別URLには確認を流用しません。Interoperability ProfileはURLに`ID1`、本文タイトルに`draft 00`とある版で、公開段階はImplementer's Draftのままです。カタログの数値版は全件`1_0`ですが、URLと本文ハッシュも一致条件に含まれます。

## SSF本体

対象: [OpenID Shared Signals Framework Specification 1.0](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html)

| 節 | 原文で確認した内容 |
| --- | --- |
| [§2 Subject Principals](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-2) / [§3 Subject Members](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-3) | 人・デバイス・セッション等について通知するための主体と識別形式を定義する。 |
| [§4.1.1〜§4.1.3](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-4.1.1) | SETを`typ: secevent+jwt`で区別し、通常のJWTのsubやexpをSSFのSETに置かない要件を定義する。 |
| [§4.2.1 events](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-4.2.1) | eventsクレームのURIキーとイベントオブジェクトを定義する。原則は1イベントで、複数URIを使えるのは同じイベントタイプの代替URIの場合に限る。 |
| [§6 Event Delivery](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-6) / [§7.1.1 Authorization Scheme](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-7.1.1) / [§8 Management API](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-8) | Push/Poll配送、設定発見、Stream管理と受信者の権限を扱う。SSF固有の認証方式やOAuthの一律必須化を定義するという読み方はしない。 |
| [§8.1.4.1 Verification](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-8.1.4.1) / [§8.1.5 Stream Updated](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html#section-8.1.5) | ストリームの配送確認と状態変更を表す共通イベントを定義する。 |

判定: 認証後のセッション・リスク状態を交換する基盤として、認証・認可に関連する仕様。

## CAEP

対象: [OpenID Continuous Access Evaluation Profile 1.0](https://openid.net/specs/openid-caep-1_0-final.html)

[§1](https://openid.net/specs/openid-caep-1_0-final.html#section-1)と[§3 Event Types](https://openid.net/specs/openid-caep-1_0-final.html#section-3)で、セッション失効、トークンクレーム・資格情報・認証保証レベル・端末準拠状態・リスクの変化とセッションの確立・提示を通知するイベントを定義する。[§4](https://openid.net/specs/openid-caep-1_0-final.html#section-4)ではSSFと組み合わせた交換を勧告している。

異なるイベントタイプURIは8種類:

- `assurance-level-change`
- `credential-change`
- `device-compliance-change`
- `risk-level-change`
- `session-established`
- `session-presented`
- `session-revoked`
- `token-claims-change`

判定: 継続的なアクセス判断と認証済みセッションの管理に直接関連する仕様。

## RISC

対象: [OpenID RISC Profile Specification 1.0](https://openid.net/specs/openid-risc-1_0-final.html)

[§1](https://openid.net/specs/openid-risc-1_0-final.html#section-1)と[§2 Event Types](https://openid.net/specs/openid-risc-1_0-final.html#section-2)で、アカウント・識別子・資格情報のリスクと復旧、RISCイベント共有のOpt Out状態等を通知するイベントを定義する。

異なるイベントタイプURIは14種類（非推奨の1種類を含む）:

- `account-credential-change-required`
- `account-disabled`
- `account-enabled`
- `account-purged`
- `credential-compromise`
- `identifier-changed`
- `identifier-recycled`
- `opt-in`
- `opt-out-cancelled`
- `opt-out-effective`
- `opt-out-initiated`
- `recovery-activated`
- `recovery-information-changed`
- `sessions-revoked`：非推奨

[§2.11](https://openid.net/specs/openid-risc-1_0-final.html#section-2.11)は`sessions-revoked`を非推奨とし、新規実装にはCAEPの`session-revoked`を要求する。両者を同じURIとして扱わない。また[§3.1](https://openid.net/specs/openid-risc-1_0-final.html#section-3.1)の旧Google実装の識別形式フィールド`subject_type`も非推奨であり、新規サービスで使用しない要件を確認した。

判定: アカウント侵害・停止・復旧等と認証・認可判断を連携するために直接関連する仕様。

## CAEP Interoperability Profile

対象: [CAEP Interoperability Profile 1.0 - draft 00（URLはID1）](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html)

| 節 | 原文で確認した内容 |
| --- | --- |
| [§1 Introduction](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-1) / [§2.2 Version](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.2) | セッション失効と資格情報変更のユースケースを対象とする相互運用要件。CAEP Implementer's Draft 2のイベントを対象とする。 |
| [§2.3 Transmitters](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.3) / [§2.4 Receivers](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.4) / [§2.6 Signatures](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.6) | 設定・ステータス・検証の各エンドポイント、配送方法、2048ビット以上の鍵を用いたRS256署名等の要件を定義する。 |
| [§2.7 OAuth Service](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.7) | アクセストークンの取得、API用scope、権限・有効期限・失効等を検証する保護リソースとしてのSSF APIを規定する。 |
| [§2.8.1 events](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-2.8.1) | eventsクレームに1イベントだけを含めることを要求する。 |
| [§3.1 Logout](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-3.1) / [§3.2 Credential Change](https://openid.net/specs/openid-caep-interoperability-profile-1_0-ID1.html#section-3.2) | 既存のCAEP session-revoked / credential-changeと、そのフィールド値の扱いを絞り込む。新しいEvent Typeの定義ではない。 |

判定: SSF/CAEPによる認証済みセッションの安全性と、管理APIの認可に直接関連する仕様。このDraftに限定した確認であり、CAEP Finalの全イベントへの相互運用性や製品の適合性を検証したものではない。

## 登録範囲

このPRで確認済みにするのは上記4件のURL・版・本文ハッシュの組み合わせです。別URLの旧Draftや、将来変更される本文に確認結果を流用しません。収集・表示・サンプルのコード変更は含みません。
