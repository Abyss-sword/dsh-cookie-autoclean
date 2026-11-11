# DSH cookie autoclean（プラグイン版 v2.2）

**[English](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [简体中文](README.zh.md)**

DSH デスクトップ用プラグインです。セッションが終了するたびに、たまり続ける `dsh-auth-*` ループバック Cookie を
自動で削除し、起動時の `desktop welcome: Web authentication failed`（HTTP 431）を防ぎます。

## インストール

```powershell
git clone https://github.com/Abyss-sword/dsh-cookie-autoclean.git
# DSH の Plugin Manager でこのディレクトリを指定して bundle をインストールするか、次を実行:
dsh --profile desktop plugin add dsh-cookie-autoclean
```

インストールすると、起動のたびに終了ウィンドウ用ヘルパーが自動で待機します。設定は不要です。
アンインストールは Plugin Manager からこの bundle を削除するだけです。

## 自前のプラグインマーケット索引

リポジトリには format 1 形式のマーケット索引 [market/index.json](market/index.json) が同梱されています
（アイコンは data URL で埋め込み済みなので、他の何かをホストする必要はありません）。DSH プラグインマーケットの
索引リストに追加すると、Discover ページから閲覧・インストールできます:

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://cdn.jsdelivr.net/gh/Abyss-sword/dsh-cookie-autoclean@main/market/index.json
```

`raw.githubusercontent.com` でも動作します（ミラーは jsDelivr）。索引は git コミットに固定されています。
新しいバージョンを公開したら `node scripts/gen-market-index.mjs` を再実行してコミットしてください
（`scripts/validate-market-index.mjs` が公式 format 1 規則で検証します）。

## プロセス内では掃除できない理由

- クライアント実行中、Chromium が Cookie データベース（`Network\Cookies`）を共有読み取り不可の形で占有しているため、
  他のプロセスは開けません。
- ホストプラグインは Electron シェルの純 Node 子プロセス内で動くため、`session.cookies` ハンドルを持ちません。
- 書き込み可能なのはクライアントが完全に終了した後だけですが、その時点でプラグインプロセス自身は既に存在しません。

## 動作（完全自動）

1. **終了ウィンドウ用ヘルパー（主経路）**: 起動のたびに独立した `helper.js` を生成します。3 秒ごとに SQLite の
   書き込みロックを取得できるか確認し、クライアントが完全に終了してロックが解放されると、データベースをバックアップし、
   ループバック（`127.0.0.1` / `localhost` / `[::1]`）の `dsh-auth-*` Cookie を**すべて**削除して終了します。
   次回起動時に新しい Cookie が再発行されるため、全削除してもログインに影響はありません。
2. **アプリのプロセスツリー外で起動（重要）**: デスクトップシェルは終了時にプロセスツリーを一括終了させるため、
   通常の detached 子プロセスは道連れにされます。そこで Windows ではヘルパーを
   **WMI（`Invoke-CimMethod Win32_Process.Create`）** 経由で起動します。親は cmd.exe / WmiPrvSE となり、
   アプリのツリー外なので終了時のツリーキルでは止まりません。PowerShell/WMI が使えない場合は detached spawn に
   フォールバックします。
3. **起動後の即時試行（フォールバック）**: 有効化から 45 秒後に、最新の Cookie を残す形でプロセス内掃除を試みます。
   Windows では必ず busy となってヘルパーに任せますが、ロックが緩い環境ではその場で実行されます。

安全境界は手動スクリプトと同じです。触るのはループバックの `dsh-auth-*` Cookie のみ。書き込みはデータベースの
`BEGIN IMMEDIATE` から始まり、タイムスタンプ付きバックアップ（`-wal`/`-shm`/`-journal` を含む）を先に取り、
スキーマを確認してから書き込みます。アカウント資格情報、セッション、プラグイン設定には一切触れません。

## 確認方法

結果は `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json` に書き出され、
詳細なタイムラインは同じディレクトリの `dsh-cookie-autoclean.log` に記録されます
（起動・待機・掃除・エラーがすべて記録されます）。

ステータスファイルの例:

```json
{
  "phase": "armed",              // armed = 終了待ちのヘルパーが待機中。cleaned = 終了ウィンドウで掃除済み。error = エラー
  "pid": 15340,
  "armedAt": "2026-11-11T08:58:48.805Z",
  "lastClean": {                 // 実際に行を削除した直近の掃除の要約（再起動を跨いで保持）
    "cleanedAt": "2026-11-11T08:39:37.010Z",
    "removed": 1,
    "total": 1,
    "db": "...\\Network\\Cookies",
    "backup": "...\\Cookies.bak-20261111-083936"
  }
}
```

確認方法:

1. ステータスファイルを読む:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.json"`
2. ログを読む:
   `Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\dsh-cookie-autoclean.log" -Tail 20`
3. クライアントを完全に終了した後、読み取り専用スクリプトで確認:
   `node dsh-cookie-cleanup\clean-dsh-cookies.mjs --dry-run`（`dsh-auth` が 0 行になるはず）
4. バックアップを見る: 各 `Network\Cookies.bak-<timestamp>` は 1 回の掃除のスナップショットです。

## 制限とトラブルシューティング

- **クライアントはトレイアイコン → 終了で閉じてください**。ウィンドウを閉じるだけではトレイに隠れるだけで、
  データベースはロックされたままです。
- すでに 431 で起動できない場合、プラグインは読み込まれません。クライアントを完全に終了してから
  `dsh-cookie-cleanup\clean-dsh-cookies.mjs --yes` を一度実行してください。以降の起動は自動で掃除されます。
- 終了後にログに `helper start` はあるのに `cleaned` がない場合、ヘルパーがロックを取れなかったか終了させられています。
  ログの末尾を添えて Issue を立ててください（`DeepSeek Harness.exe` の残留プロセスも確認してください）。
- **バックアップは最新 10 個だけ保持**され、古いものは自動削除されます。
- Cookie データベースが見つからないヘルパー（例: デスクトップ以外のプロファイルに入れた場合）は 10 分後に自動終了します。
- 45 秒後のプロセス内試行はフォールバックです。Windows ではデータベースが排他ロックされているため busy になり、
  実際の掃除は終了ウィンドウ用ヘルパーが行います。

## 設定レイヤー（削除済み）

プロファイルの `connection.cookieMaxAgeDays` を小さくする回避策を試しましたが、元に戻しています。
`dsh-client-connection` の `authenticate()` は Cookie に署名された `expiresAt` を検証し、自動再認証の経路はないため、
設定した日数より長くクライアントを起動し続けると 401 が始まります。現在は「終了のたびに掃除」だけに依存しています。
各セッションは Cookie ゼロで終わり、次の起動でちょうど 1 個だけ発行されます。

## 互換性と免責

- DSH デスクトップクライアントの非公開実装詳細に依存しています（Chromium Cookie ストアのレイアウト、`dsh-auth-*` の命名、
  終了時のプロセスツリー解体、WMI 起動プロセスがアプリのツリー外であること）。**DSH のアップグレードで挙動が
  変わる可能性**があるため、ログで `cleaned` が出続けるか確認してください。
- 完全に検証したのは Windows のみ（WMI 経路）。macOS/Linux は detached spawn のフォールバックを使い、未検証です。
- プラグインはループバックの `dsh-auth-*` Cookie のみを削除し、アカウント資格情報・セッション・設定には触れません。
  書き込み前にデータベースをバックアップします。

## License

[MIT](LICENSE) © 2026 Abyss-sword
