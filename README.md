# X Bookmark to Drive Saver

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Chrome Extension](https://img.shields.io/badge/chrome-extension-green.svg)

Xのブックマークした投稿をGoogle Driveに保存し、NotebookLMで活用できるChrome拡張機能

## 🎯 概要

X（旧Twitter）のブックマーク機能は便利ですが、以下の問題があります：

- **検索が困難** - 大量のブックマークから目的の情報を探すのは大変
- **失われる可能性** - アカウント削除や投稿削除で情報が失われる
- **活用が難しい** - せっかく保存した情報を有効活用できない

この拡張機能は、ブックマークを **Google Drive** に保存し、**NotebookLM** で AIを活用した情報管理を可能にします。

## ✨ 機能

- ✅ **自動収集** - ブックマークを自動スクロールで収集
- ✅ **完全な情報取得**
  - 投稿テキスト
  - 画像URL（複数対応）
  - 動画URL
  - スレッド全体
  - 投稿者情報
  - エンゲージメント指標
- ✅ **複数形式対応** - Markdown / JSON / Text
- ✅ **Google Drive連携** - 自動アップロード
- ✅ **NotebookLM対応** - そのままソースとして利用可能

## 📋 必要要件

- Google Chrome ブラウザ（最新版推奨）
- Googleアカウント
- Xアカウント（ブックマーク機能を使用）

## 🚀 セットアップ

### ステップ1: Google Cloud Project設定

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス

2. 新しいプロジェクトを作成
   - プロジェクト名: 任意（例: "X Bookmark Saver"）

3. **Google Drive API を有効化**
   - 「APIとサービス」 > 「ライブラリ」
   - "Google Drive API" を検索
   - 「有効にする」をクリック

4. **OAuth同意画面を設定**
   - 「APIとサービス」 > 「OAuth同意画面」
   - User Type: 「外部」を選択
   - アプリ名: 任意（例: "X Bookmark Saver"）
   - サポートメール: 自分のメールアドレス
   - スコープ: `.../auth/drive.file` を追加
   - テストユーザー: 自分のGoogleアカウントを追加

5. **OAuth 2.0 クライアントIDを作成**
   - 「APIとサービス」 > 「認証情報」
   - 「認証情報を作成」 > 「OAuth クライアント ID」
   - アプリケーションの種類: **「Chrome アプリ」**
   - 名前: 任意
   - アプリケーションID: `後で設定（一旦空欄でOK）`
   - 作成後、**クライアントID** をコピー

### ステップ2: Chrome拡張のインストール

1. このリポジトリをクローンまたはダウンロード
   ```bash
   git clone https://github.com/yourusername/X_bookmark_file.git
   cd X_bookmark_file
   ```

2. `manifest.json` を編集
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
     "scopes": [
       "https://www.googleapis.com/auth/drive.file"
     ]
   }
   ```
   - `YOUR_CLIENT_ID_HERE` を先ほどコピーしたクライアントIDに置き換え

3. **Chrome拡張として読み込み**
   - Chrome で `chrome://extensions/` を開く
   - 右上の「デベロッパーモード」をON
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `X_bookmark_file` フォルダを選択

4. **拡張機能IDを取得**
   - 読み込まれた拡張機能のIDをコピー（例: `abcdefghijklmnopqrstuvwxyz123456`）

5. **Google Cloud Consoleで拡張機能IDを設定**（重要）
   - Google Cloud Console > 「認証情報」
   - 作成したOAuth 2.0 クライアントIDを編集
   - アプリケーションID: 拡張機能IDを貼り付け
   - 保存

### ステップ3: アイコンのカスタマイズ（任意）

現在、プレースホルダーアイコンが設定されています。カスタムアイコンを作成する場合：

1. `icons/icon.svg` を開く（提供済みのSVGテンプレート）

2. オンラインSVG → PNG変換ツールを使用（例）：
   - [CloudConvert](https://cloudconvert.com/svg-to-png)
   - [Convertio](https://convertio.co/ja/svg-png/)

3. 以下のサイズで変換：
   - 16x16px → `icons/icon16.png`
   - 48x48px → `icons/icon48.png`
   - 128x128px → `icons/icon128.png`

4. Chrome拡張を再読み込み

## 📖 使い方

### 1. Xにログイン

ブラウザでXにログインし、ブックマークページを開きます：
```
https://x.com/i/bookmarks
```

### 2. 拡張機能を起動

- ツールバーの拡張機能アイコンをクリック
- または、`Alt+Shift+X`（カスタマイズ可能）

### 3. Google認証

初回のみ：
1. 「Google認証」ボタンをクリック
2. Googleログイン画面が表示されます
3. アクセスを許可
4. 「✓ 認証済み」と表示されれば完了

### 4. ブックマークを収集

1. **取得する投稿数** を設定（0 = 全て）
2. オプションを選択：
   - ☑️ **画像を含める** - 画像URLを取得
   - ☑️ **スレッド全体を含める** - 返信スレッドも取得

3. 「**ブックマークを収集**」をクリック

4. 自動的にページがスクロールし、ブックマークを収集
   - プログレスバーで進捗確認
   - ログに収集状況が表示

### 5. エクスポート

1. **形式を選択**：
   - **Markdown (.md)** - NotebookLMに最適、人間も読みやすい
   - **JSON (.json)** - プログラムでの処理に最適、すべてのメタデータ保持
   - **Text (.txt)** - シンプルなテキスト形式

2. 「**Google Driveに保存**」をクリック

3. 成功メッセージとファイルURLが表示されます

4. Google Driveを開いて確認

## 🧠 NotebookLMでの活用

### ステップ1: NotebookLMにアクセス

[NotebookLM](https://notebooklm.google.com/) を開きます

### ステップ2: ソースを追加

1. 新しいノートブック作成
2. 「ソースを追加」をクリック
3. 「Google Drive」を選択
4. エクスポートしたファイルを選択（推奨: Markdown形式）

### ステップ3: AIで情報を活用

NotebookLMのAIに質問してみましょう：

**例：**
- "最も興味深い技術トピックをまとめて"
- "機械学習に関する投稿を抽出して"
- "〇〇さんの投稿の要約を作成して"
- "この中から実用的なTipsを10個リストアップして"

### ステップ4: ナレッジベースを構築

定期的にブックマークをエクスポートすることで：
- **情報の資産化** - 価値ある情報を永続的に保存
- **AIによる分析** - パターンや洞察を発見
- **検索性の向上** - 自然言語で情報を検索
- **知識の整理** - トピック別に自動分類

## 🔧 トラブルシューティング

### 認証エラーが発生する

**原因**: OAuth設定が正しくない

**解決方法**:
1. Google Cloud Consoleでテストユーザーに自分のアカウントを追加
2. OAuth同意画面の公開状態を確認
3. 拡張機能IDがOAuth 2.0クライアントに正しく設定されているか確認
4. Chrome拡張を再読み込み

### ブックマークが取得できない

**原因**: ブックマークページで実行していない、またはXの仕様変更

**解決方法**:
1. `https://x.com/i/bookmarks` で実行しているか確認
2. ページを再読み込みしてから実行
3. Chrome DevToolsのコンソールでエラーを確認
4. GitHubのIssuesで報告（Xの仕様変更の可能性）

### 画像が表示されない

**原因**: 元の投稿が削除された、または画像URLが無効

**説明**:
- 画像URLは保存時点のものです
- 元ツイートが削除されると画像も表示できなくなります
- これはXの仕様によるものです

### アップロードが失敗する

**原因**: ネットワークエラー、トークン無効、APIクォータ超過

**解決方法**:
1. インターネット接続を確認
2. 「再認証」をクリックしてトークンをリフレッシュ
3. Google Cloud ConsoleでAPIクォータを確認
4. 少量のブックマークで試す

### 「このアプリは確認されていません」と表示される

**原因**: OAuth同意画面が未公開

**解決方法**:
1. これは正常な動作です（個人用アプリのため）
2. 「詳細」をクリック
3. 「〇〇（安全ではないページ）に移動」をクリック
4. または、OAuth同意画面を「本番」ステータスに変更（審査が必要）

## 🛠️ 技術スタック

- **Chrome Extension Manifest V3** - 最新のChrome拡張規格
- **Google Drive API v3** - ファイルストレージ
- **OAuth 2.0** - セキュアな認証
- **Vanilla JavaScript** - 依存ライブラリなし

### ファイル構成

```
X_bookmark_file/
├── manifest.json       # Chrome拡張の設定
├── popup.html          # ポップアップUI
├── popup.js            # UI制御ロジック
├── styles.css          # スタイルシート
├── content.js          # Xページからのデータ抽出
├── background.js       # Google Drive API連携
├── icons/              # アイコン画像
│   ├── icon.svg       # SVGテンプレート
│   ├── icon16.png     # 16x16
│   ├── icon48.png     # 48x48
│   └── icon128.png    # 128x128
└── README.md           # このファイル
```

## 🔒 プライバシーとセキュリティ

- **最小限の権限**: `drive.file` スコープのみ（作成したファイルのみアクセス）
- **ローカル処理**: データはブラウザ内で処理され、第三者サーバーに送信されません
- **OAuth 2.0**: Googleの安全な認証フロー
- **オープンソース**: コードは完全に公開されており、監査可能

## 📊 データ形式の詳細

### Markdown形式（推奨）

```markdown
# X Bookmarks Export

エクスポート日時: 2024-01-01 12:00:00
総数: 50件

---

## 1. ユーザー名 (@username)

**投稿日時**: 2024-01-01T12:00:00Z

投稿本文がここに入ります...

### 画像
![画像1](https://pbs.twimg.com/media/xxx.jpg)

### スレッド (3件)
#### 1. フォロワー (@follower)
返信内容...

[元の投稿を見る](https://x.com/username/status/123456789)

---
```

### JSON形式

```json
[
  {
    "author": {
      "name": "ユーザー名",
      "username": "username"
    },
    "text": "投稿本文",
    "timestamp": "2024-01-01T12:00:00Z",
    "images": [
      {
        "url": "https://pbs.twimg.com/media/xxx.jpg",
        "alt": "画像の説明"
      }
    ],
    "videos": [],
    "url": "https://x.com/username/status/123456789",
    "metrics": {
      "replies": 10,
      "retweets": 20,
      "likes": 100
    },
    "thread": []
  }
]
```

## 🤝 貢献

バグ報告、機能リクエスト、プルリクエストを歓迎します！

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📝 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照

## 🙏 謝辞

- X (Twitter) - ブックマーク機能の提供
- Google - Drive API と NotebookLM
- Chrome Extension コミュニティ

## 📧 サポート

問題が発生した場合：
1. このREADMEのトラブルシューティングセクションを確認
2. [GitHub Issues](https://github.com/yourusername/X_bookmark_file/issues) で報告
3. Chrome DevToolsのコンソールログを添付すると解決が早くなります

---

**Xのブックマークを知識資産に変換しましょう！** 🚀📚
