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
  （`%APPDATA%\com.hashimotok0808.jarvis\jarvis.db`）
- 「接続テスト」で Gemini / Ollama の疎通を確認できます

### 2. Ollama（ローカルLLM）

```powershell
ollama pull qwen2.5:7b-instruct
ollama serve
```

既定の接続先は `http://127.0.0.1:11434`（設定で変更可）。

### 3. 音声入力（STT）

日本語の音声認識は **speech.cpp + Haas-ja-v1.0** を既定にしています。
設定画面の「取得」から実行ファイルとモデルを落とすだけで使えます。

#### A. speech.cpp（既定・推奨）

1. 設定 → **音声入力（STT）** の「認識エンジン」で
   `speech.cpp（Haas-ja・高速）` を選びます。
2. 「speech.exe」の **「取得」** を押すと、speech.cpp の最新 Windows 版
   （Vulkan ビルド）を `usr\bin\speech.exe` に配置します。
3. 「認識モデル」の **「取得」** を押すと、Haas-ja-v1.0 Q8_0（約626 MiB）を
   `usr\models\Haas-616M-ja-v1.0-Q8_0.gguf` に保存します。
4. 保存すると次の文字起こしから使われます。初回だけウォームアップに
   数秒かかり、以降は常駐ワーカーが応答します。

実測値（RTX 3060 Ti / Vulkan、Q8_0）:

| 項目 | 時間 |
|---|---|
| ワーカー起動（ウォームアップ込み） | 約1.8秒 |
| 1発話（1.5秒の音声） | 約43ms |
| 1発話（6秒の音声） | 約80〜105ms |

- 起動語「ジャービス」は Haas のカスタム語彙に自動登録されます
  （設定の「起動語を語彙に登録」）。「じゃあびす」などの聞き取りも
  表記ゆれとして吸収されます。
- speech.cpp が見つからない・失敗した場合は whisper.cpp に自動で切り替わります。
- GPU が Vulkan 非対応の場合は「実行デバイス」を `CPU` にしてください
  （CPU でも 1発話あたり 1 秒未満で認識できます）。

#### B. whisper.cpp（代替）

whisper.cpp はソースコードだけでは音声入力に使えません。JARVIS には
`whisper-cli.exe` と Whisper モデル（`.bin`）の両方が必要です。

##### B-1. whisper-cli.exe を用意する

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

##### B-2. 日本語モデルをダウンロードする

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

##### B-3. JARVIS にファイルの場所を設定する

1. JARVIS を起動し、歯車アイコンから設定を開きます。
2. **音声入力（STT）**で「音声入力」を有効にし、認識エンジンを
   `whisper.cpp` に切り替えます。
3. 「whisper-cli.exe」の「参照」を押し、手順 B-1 で確認した exe を選びます。
4. 「ggml モデル」の「参照」を押し、次のモデルファイルを選びます。
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
- インストーラ: `src-tauri/target/release/bundle/nsis/JARVIS_0.4.4_x64-setup.exe`

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
（exe と同じ場所に書き込みできない場合は `%APPDATA%\com.hashimotok0808.jarvis` に自動フォールバック）

アプリのエラーや警告は `usr\logs\jarvis.log` に記録されます。
`usr` に書き込めない環境では `%LOCALAPPDATA%\JARVIS\logs\jarvis.log`
に保存されます。Edge TTS から SAPI へ切り替わった場合の理由も記録します。

## アップデート

`updates\latest.json` を見て更新を検知します（[updates/README.md](./updates/README.md)）。
設定 → アップデート → **更新元フォルダ** で、監視するフォルダを「参照」から選べます
（例: `D:\プログラミング\AI_Project\JARVIS\updates`）。
指定フォルダの `latest.json` とインストーラを優先して確認し、
**更新元を監視** が有効なら設定した間隔（既定60秒）で自動的に再確認します。
未設定の場合は exe 隣接フォルダとビルド時のリポジトリ `updates` を確認します。
v0.2.0より前のアプリはリポジトリ内フォルダを確認しないため、
最初のv0.2.0への更新だけはインストーラを手動で実行してください。

1. `latest.json` の `version` を新バージョンにし、`installer` にインストーラのファイル名を書く
2. 同じフォルダにインストーラ（例: `JARVIS_0.4.4_x64-setup.exe`）を置く
3. アプリ再起動（または設定 → アップデート → 再確認）
4. ヘッダーに「更新 v0.4.4」が出る → 設定 → 「インストーラを起動」

インストーラ起動時にアプリは自動終了し、更新後は `usr` のデータを引き継いで再起動できます。
更新後は初回起動時に前回と現在のバージョンを通知します。

## 操作

| 操作 | キー / 場所 |
|---|---|
| 送信 / 改行 | Enter / Shift + Enter |
| 会話の全文検索 | Ctrl + K |
| クイック入力パレット | Ctrl + Alt + Q（グローバル） |
| 選択テキストをJARVISへ送る | Ctrl + Alt + S（グローバル） |
| 記憶とテンプレート | Ctrl + Shift + M |
| 新規スレッド | Ctrl + N |
| 音声入力の開始・停止 | Ctrl + Alt + Space（グローバル） |
| HUD 表示切替 | Ctrl + Alt + H（グローバル） |
| トレイメニュー | 表示 / HUD 切替 / 音声入力 / ミュート切替 / 終了 |

### スラッシュコマンド（入力欄で `/`）

| コマンド | 内容 |
|---|---|
| `/help` | コマンド一覧 |
| `/new` | 新しいスレッド |
| `/summarize` | 現在のスレッドを要約して文脈に圧縮 |
| `/digest` | 直近24時間の振り返り |
| `/memory <内容>` | 長期記憶に保存（引数なしで管理画面） |
| `/clip` | クリップボードの内容を要約 |
| `/image` | 画面をキャプチャして解析（Vision対応モデル） |
| `/timer <分> [名前]` | タイマーとデスクトップ通知 |
| `/export` | 全スレッドを Markdown 書き出し |
| `/t <名前>` | テンプレートを実行 |

- 音声入力は VAD で無音 0.8 秒を検出すると自動で文字起こし→送信
- 「ハンズフリー」を有効にすると、読み上げ後に自動で聞き取りを再開
- 「ジャービス」と呼びかけると、呼び名を添えて要件を尋ね、続く発話を待つ
- 設定画面の「呼びかけを登録（5回）」で、既存の登録を消してから5回録音し直せる
  （画面の波形表示と読み上げで進み具合を案内、聞き取れた言い方だけを保存）
- whisper-cli.exe / ggml モデル / 更新元フォルダは「参照」からエクスプローラーで選択
- VADしきい値は設定画面から周囲の音を測定して自動調整可能
- HUDは固定位置・幅・高さを設定でき、ウェイクワード後は前面に表示
- 起動語は whisper.cpp の文字起こし結果で判定するため、専用検出器ではありません
- 読み上げが有効なら起動時に挨拶し、設定の「呼び名」を「〇〇様」に反映
- 音声認識は speech.cpp の常駐ワーカーで Haas-ja-v1.0 を利用（失敗時は whisper.cpp へ）
- 読み上げは edge-tts。失敗時は Windows SAPI に自動フォールバック
- Edge TTS は更新された認証プロトコルを持つ edge-tts-rust を使用
- メインウィンドウを閉じてもトレイに常駐（終了はトレイメニューから）
- 二重起動した場合は既存ウィンドウを前面に表示（新規プロセスは起動しない）

## 現在の状態

| フェーズ | 内容 | 状態 |
|---|---|---|
| P0 | 環境構築・雛形・HUD 骨格 | 完了 |
| P1 | テキストチャット（Gemini → Ollama）＋履歴保存 | 完了 |
| P2 | 音声入力（speech.cpp + Haas-ja-v1.0 / whisper.cpp）＋音声出力（edge-tts/SAPI） | 完了 |
| P3 | 常駐・トレイ・HUD・VAD ハンズフリー | 完了 |
| P3.5 | 指定フォルダへのインストール・`usr` データ領域・ローカル更新通知 | 完了 |
| P4 | 添付・長期記憶 | 完了（v0.3.0） |
| P5 | ツール実行 | 完了（v0.3.0） |

### v0.4.4 で修正した内容

- **ハンズフリー**: 回答が終わった後は、次に話すときに再び「ジャービス」が必要
  - 「ジャービス」だけ呼んだ場合の「ご要件は？」直後の1回だけ起動語なしで受け付け

### v0.4.3 で追加した機能

- **状態インジケーター**: トレイとタスクバーのアイコン色で状態を表示
  - 緑=待機 / 青=聞き取り中 / 黄=思考中 / 水色=発話中（トレイのツールチップも連動）
- **OpenCode Go**: 常駐 `opencode web`（OpenAI互換）をプロバイダとして追加
  - ベースURL・APIキー（`oc_sk_...`）・通常/重量級モデルを設定可能
  - 接続テスト、自動振り分け（コーディング/分析は重量級モデル）、フォールバック対応
- **設定UI**: 左目次＋メインの2ペイン構成。ダイアログを画面いっぱいに拡大
  - プロバイダの追加/削除、現在のHUD位置の記憶

### v0.3.0 で追加した機能

- **検索**: 全スレッド本文の全文検索（FTS5 + 日本語trigram、Ctrl + K）
- **会話操作**: 再生成・編集して再送・メッセージ単位の分岐・コピー
- **音声**: バージイン（発話中の割り込み）・起動語の常時監視・ピッチ/ボイスプリセット
  - 起動語は「1回録音」または「5回まとめて録音」で1件ずつ登録
  - 音声で話しかけたターンは Ollama（ローカル）を優先
- **記憶**: 長期記憶の自動抽出・注入・手動管理、スレッド要約による文脈圧縮、日次ダイジェスト
- **ツール実行**: Web検索、アプリ/URL起動、ファイル読み書き、クリップボード、スクリーンショット、タイマー通知、記憶保存
- **MCP**: stdio サーバーのツールを Function Calling に統合（設定で追加）
- **承認フロー**: 書き込み・起動・読み取りは実行前に確認ダイアログ
- **デスクトップ統合**: クイック入力パレット、選択テキスト送信、クリップボード監視、デスクトップ通知
- **画像**: 画面キャプチャ/画像添付による Vision 問い合わせ
- **モデル**: 簡易プロンプトは Ollama、重い処理はクラウドへ自動振り分け
- **運用**: 使用量統計（回数・文字数・平均レイテンシ）、全スレッド書き出し、DBバックアップ
- **UI**: ライトテーマ、文字サイズ、HUD配置プリセット、スレッド一覧のキーボード操作
  - HUD「固定」は現在の位置・サイズを記憶し、最前面に表示したまま固定
- **起動の堅牢化**: DBをウィンドウ生成前に初期化し、破損時は復旧用DB/メモリDBへフォールバック

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
  features/memory/        # 長期記憶・テンプレート管理
  features/quick/         # クイック入力パレット
  features/tools/         # ツール承認ダイアログ
  lib/ipc/                # Tauri コマンド / イベント購読
  shared/                 # 型・テーマトークン・Markdown描画
src-tauri/src/
  commands/               # app / threads / chat / settings / voice / memory / data / tools
  providers/              # OpenAI互換ストリーミング + ツール実行ループ + フォールバック
  tools.rs                # Function Calling ツール / MCP クライアント / 通知
  speech/                 # whisper.cpp 呼び出し / edge-tts + SAPI
  db.rs                   # SQLite マイグレーションとCRUD
  secrets.rs              # DPAPI
  state.rs                # 共有状態
src-tauri/binaries/       # whisper-cli.exe / ggml-*.bin（ローカルのみ）
src-tauri/nsis/           # インストーラのカスタムテンプレート
updates/                  # ローカルのアップデート情報（latest.json）
logs/                     # 仕様ドラフト
```
