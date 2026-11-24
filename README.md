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

whisper.cpp はソースコードだけでは音声入力に使えません。JARVIS には
`whisper-cli.exe` と Whisper モデル（`.bin`）の両方が必要です。

#### A. whisper-cli.exe を用意する

GitHub の [Releases](https://github.com/ggml-org/whisper.cpp/releases)
に Windows 用の実行ファイルが添付されていない場合は、手元のソースから
ビルドしてください。たとえば
`C:\MyProgram\whisper.cpp-1.9.6` にソースを展開済みの場合:

1. Visual Studio 2022 または Visual Studio 2022 Build Tools をインストールし、
   **「C++ によるデスクトップ開発」**を選択します。
2. CMake をインストールします。インストーラで PATH に追加します。
3. **Developer PowerShell for VS 2022** を開き、次を実行します。
   `CC=clang` など別のコンパイラ設定や、以前の失敗した CMake キャッシュを
   避けるため、MSVC 用の新しいビルドフォルダを使います。

   ```powershell
   Set-Location 'C:\MyProgram\whisper.cpp-1.9.6'
   Remove-Item Env:CC,Env:CXX -ErrorAction SilentlyContinue
   cmake -S . -B build-msvc -G 'Visual Studio 17 2022' -A x64
   cmake --build build-msvc --config Release --parallel
   ```

4. 生成された実行ファイルを探します。Visual Studio の構成によって
   出力先が異なるため、次のコマンドで実際のパスを確認してください。

   ```powershell
   Get-ChildItem .\build-msvc -Filter whisper-cli.exe -Recurse |
     Select-Object -ExpandProperty FullName
   ```

   `CMAKE_C_COMPILER` に関するエラーが続く場合は、
   **Developer PowerShell for VS 2022** で実行しているか、
   Visual Studio Installer で「C++ によるデスクトップ開発」が入っているか
   確認してください。`build-msvc` を以前に別コンパイラで作成していた場合は、
   そのフォルダを削除してから上記の configure コマンドをやり直してください。

#### B. 日本語モデルをダウンロードする

ソースフォルダにあるモデル取得スクリプトを使います。

```powershell
Set-Location 'C:\MyProgram\whisper.cpp-1.9.6'
.\models\download-ggml-model.cmd small
```

成功すると通常は
`C:\MyProgram\whisper.cpp-1.9.6\models\ggml-small.bin` が作成されます。
`small` は多言語モデルで、日本語の文字起こしに使えます（ダウンロード
サイズは約466 MiB）。英語専用の `small.en` は選ばないでください。
`for-tests-ggml-small.bin` はテスト用の空ファイルなので使用できません。

#### C. JARVIS にファイルの場所を設定する

1. JARVIS を起動し、歯車アイコンから設定を開きます。
2. **音声入力（STT / whisper.cpp）**で「音声入力」を有効にします。
3. 「whisper-cli.exe」に、手順 A で確認した exe のフルパスを入力します。
4. 「ggml モデル」に次のモデルファイルのフルパスを入力します。
   `C:\MyProgram\whisper.cpp-1.9.6\models\ggml-small.bin`
5. 設定を保存し、音声入力を試します。

exe とモデルを `src-tauri/binaries/` に配置する方法もありますが、
設定画面でフルパスを指定する方法が確実です。未設定またはファイルが
見つからない場合、音声入力は利用できず、設定画面に検出状態が表示されます。

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
- インストーラ: `src-tauri/target/release/bundle/nsis/JARVIS_0.2.0_x64-setup.exe`

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
│  ├─ logs\            #   jarvis.log（アプリ・音声・UIエラー）
│  └─ version.txt      #   前回起動時のバージョン
└─ updates\
   └─ latest.json      # ローカルのアップデート情報
```

`usr` の場所は環境変数 `JARVIS_DATA_DIR` でも上書きできます。
（exe と同じ場所に書き込みできない場合は `%APPDATA%\com.monster2408.jarvis` に自動フォールバック）

アプリのエラーや警告は `usr\logs\jarvis.log` に記録されます。
`usr` に書き込めない環境では `%LOCALAPPDATA%\JARVIS\logs\jarvis.log`
に保存されます。Edge TTS から SAPI へ切り替わった場合の理由も記録します。

## アップデート

`updates\latest.json` を見て更新を検知します（[updates/README.md](./updates/README.md)）。
実行ファイル隣接フォルダに加え、ビルド時のリポジトリにある
`D:\プログラミング\AI_Project\JARVIS\updates` も確認します。
このリポジトリで新しいインストーラを作成した場合、ダウンロード済みの
アプリから設定画面の「再確認」で更新を検出できます。
v0.2.0より前のアプリはリポジトリ内フォルダを確認しないため、
最初のv0.2.0への更新だけはインストーラを手動で実行してください。

1. `latest.json` の `version` を新バージョンにし、`installer` にインストーラのファイル名を書く
2. 同じフォルダにインストーラ（例: `JARVIS_0.2.0_x64-setup.exe`）を置く
3. アプリ再起動（または設定 → アップデート → 再確認）
4. ヘッダーに「更新 v0.2.0」が出る → 設定 → 「インストーラを起動」

インストーラ起動時にアプリは自動終了し、更新後は `usr` のデータを引き継いで再起動できます。
更新後は初回起動時に前回と現在のバージョンを通知します。

## 操作

| 操作 | キー / 場所 |
|---|---|
| 送信 / 改行 | Enter / Shift + Enter |
| 音声入力の開始・停止 | Ctrl + Alt + Space（グローバル） |
| HUD 表示切替 | Ctrl + Alt + H（グローバル） |
| トレイメニュー | 表示 / HUD 切替 / 音声入力 / ミュート切替 / 終了 |

- 音声入力は VAD で無音 0.8 秒を検出すると自動で文字起こし→送信
- 「ハンズフリー」を有効にすると、読み上げ後に自動で聞き取りを再開
- 「ジャービス」と呼びかけると、呼び名を添えて要件を尋ね、続く発話を待つ
- 設定画面で呼びかけ例を最大5件登録でき、文字起こし候補をローカル保存
- VADしきい値は設定画面から周囲の音を測定して自動調整可能
- HUDは固定位置・幅・高さを設定でき、ウェイクワード後は前面に表示
- 起動語は whisper.cpp の文字起こし結果で判定するため、専用検出器ではありません
- 読み上げが有効なら起動時に挨拶し、設定の「呼び名」を「〇〇様」に反映
- 読み上げは edge-tts。失敗時は Windows SAPI に自動フォールバック
- Edge TTS は更新された認証プロトコルを持つ edge-tts-rust を使用
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
