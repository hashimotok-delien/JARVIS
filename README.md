# J.A.R.V.I.S.

AI会話 Windows デスクトップアプリ（個人用）。
テキスト＋音声の両方に対応し、無料枠のみで運用できる構成を目指します。

仕様: [SPEC.md](./SPEC.md)

## 技術スタック

| レイヤ | 採用 |
|---|---|
| シェル | Tauri 2 |
| UI | React 19 + TypeScript + Vite |
| スタイル | Tailwind CSS v4 + framer-motion + lucide-react |
| ネイティブ | Rust（ブリッジ・HTTP ストリーミング・音声・SQLite） |

## 初回セットアップ

```powershell
npm install
```

### 1. Gemini（クラウド / 無料枠）

アプリの設定（歯車アイコン）→ プロバイダ → **Gemini API キー** を保存してください。

- キーは Windows DPAPI で暗号化して保存されます
  （`%APPDATA%\com.monster2408.jarvis\jarvis.db`）
- 「接続テスト」で Gemini / Ollama の疎通を確認できます

### 2. Ollama（ローカルLLM）

```powershell
ollama pull qwen2.5:7b-instruct
ollama serve
```

既定の接続先は `http://127.0.0.1:11434`（設定で変更可）。

### 3. whisper.cpp（音声入力）

`src-tauri/binaries/` に次の2ファイルを置くか、設定画面でパスを指定します。

- `whisper-cli.exe`（[Releases](https://github.com/ggml-org/whisper.cpp/releases)）
- `ggml-small.bin`（`ggml-base.bin` / `ggml-medium.bin` も自動検出）

未配置の場合、音声入力はエラーを表示して無効のまま動作します。

## 開発

```powershell
npm run tauri dev
```

Rust の `cargo` が PATH に無い場合は `%USERPROFILE%\.cargo\bin` を追加してください。

## ビルド（exe / インストーラ作成）

```powershell
npm run tauri build
```

- 単体 exe: `src-tauri/target/release/jarvis.exe`
- インストーラ: `src-tauri/target/release/bundle/nsis/JARVIS_0.1.0_x64-setup.exe`

## インストール

インストーラを起動すると、**インストール先フォルダを選択**できます。

- 選んだフォルダの中に `JARVIS` フォルダを作成して格納します
  （例: `D:\Tools` を選ぶ → `D:\Tools\JARVIS`）
- 既定は `%LOCALAPPDATA%\JARVIS`
- データは `usr` 内に保存されるため、アンインストールしても既定では残ります

### インストール後の構成（最小限）

```
JARVIS\
├─ jarvis.exe          # 本体
├─ uninstall.exe       # アンインストーラ
├─ usr\                # ユーザーデータ（更新・再インストールでも保持）
│  ├─ jarvis.db        #   会話履歴・設定・APIキー（DPAPI）
│  ├─ exports\         #   スレッドの書き出し先
│  ├─ logs\            #   起動ログ / クラッシュログ
│  └─ version.txt      #   前回起動時のバージョン
└─ updates\
   └─ latest.json      # ローカルのアップデート情報
```

`usr` の場所は環境変数 `JARVIS_DATA_DIR` でも上書きできます。
（exe と同じ場所に書き込みできない場合は `%APPDATA%\com.monster2408.jarvis` に自動フォールバック）

## アップデート

ローカルの `updates\latest.json` を見て更新を検知します（[updates/README.md](./updates/README.md)）。

1. `latest.json` の `version` を新バージョンにし、`installer` にインストーラのファイル名を書く
2. 同じフォルダにインストーラ（例: `JARVIS_0.2.0_x64-setup.exe`）を置く
3. アプリ再起動（または設定 → アップデート → 再確認）
4. ヘッダーに「更新 v0.2.0」が出る → 設定 → 「インストーラを起動」

インストーラ起動時にアプリは自動終了し、更新後は `usr` のデータを引き継いで再起動できます。
更新後は初回起動時に「v0.1.0 から v0.2.0 に更新されました」と通知します。

## 操作

| 操作 | キー / 場所 |
|---|---|
| 送信 / 改行 | Enter / Shift + Enter |
| 音声入力の開始・停止 | Ctrl + Alt + Space（グローバル） |
| HUD 表示切替 | Ctrl + Alt + H（グローバル） |
| トレイメニュー | 表示 / HUD 切替 / 音声入力 / ミュート切替 / 終了 |

- 音声入力は VAD で無音 0.8 秒を検出すると自動で文字起こし→送信
- 「ハンズフリー」を有効にすると、読み上げ後に自動で聞き取りを再開
- 読み上げは edge-tts。失敗時は Windows SAPI に自動フォールバック
- メインウィンドウを閉じてもトレイに常駐（終了はトレイメニューから）
- 二重起動した場合は既存ウィンドウを前面に表示（新規プロセスは起動しない）

## 現在の状態

| フェーズ | 内容 | 状態 |
|---|---|---|
| P0 | 環境構築・雛形・HUD 骨格 | 完了 |
| P1 | テキストチャット（Gemini → Ollama）＋履歴保存 | 完了 |
| P2 | 音声入力（whisper.cpp）＋音声出力（edge-tts/SAPI） | 完了（要 whisper バイナリ配置） |
| P3 | 常駐・トレイ・HUD・VAD ハンズフリー | 完了 |
| P3.5 | 指定フォルダへのインストール・`usr` データ領域・ローカル更新通知 | 完了 |
| P4 | 添付・長期記憶 | 未着手 |
| P5 | ツール実行 | 未着手 |

### 実装メモ

- プロバイダは OpenAI 互換 `/chat/completions`（SSE）で統一
  - Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`
  - Ollama: `{ollamaBaseUrl}/v1`
- レート制限・認証失敗・接続失敗時は設定したフォールバック順で次へ自動切替
- 履歴は SQLite（`threads` / `messages` / `settings` / `secrets`）
- 生成停止（■）は進行中のストリームのみ中断し、部分応答は保存

## ディレクトリ

```
src/                      # フロントエンド
  app/                    # アプリシェル
  features/chat/          # チャットUI・状態ストア
  features/hud/           # HUD オーバーレイ
  features/settings/      # 設定ダイアログ・設定ストア
  features/voice/         # 録音(VAD)・TTSキュー・音声エンジン
  lib/ipc/                # Tauri コマンド / イベント購読
  shared/                 # 型・テーマトークン・Markdown描画
src-tauri/src/
  commands/               # app / threads / chat / settings / voice
  providers/              # OpenAI互換ストリーミング + フォールバック
  speech/                 # whisper.cpp 呼び出し / edge-tts + SAPI
  db.rs                   # SQLite マイグレーションとCRUD
  secrets.rs              # DPAPI
  state.rs                # 共有状態
src-tauri/binaries/       # whisper-cli.exe / ggml-*.bin（ローカルのみ）
src-tauri/nsis/           # インストーラのカスタムテンプレート
updates/                  # ローカルのアップデート情報（latest.json）
logs/                     # 仕様ドラフト
```
