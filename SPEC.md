# JARVIS — AI会話 Windowsアプリ 仕様書 v1.0（確定版）

- 作成日: 2026-11-25
- ドラフト履歴: `logs/SPEC_AI会話アプリ_v0.1.md` → `logs/SPEC_AI会話アプリ_v0.2.md`
- 対象: Windows 11 / 個人利用（配布なし）

---

## 1. 確定事項

| # | 項目 | 決定 |
|---|---|---|
| 1 | 会話形態 | テキスト＋音声（STT/TTS）の両方 |
| 2 | AIの頭脳 | 併用。初期は無料の範囲のみ（Gemini無料枠 → Ollama追加） |
| 3 | スタック | Tauri 2 + React 19 + TypeScript + Vite |
| 4 | スコープ | 自分専用（インストーラ・自動更新・マルチユーザーなし） |
| 5 | Rustの範囲 | 薄いブリッジのみ（音声デバイス・ホットキー・トレイ・DB・サイドカー起動） |
| 6 | 初期プロバイダ | 抽象化を先に作り、**Geminiで即動作確認 → Ollama追加** |
| 7 | TTS | edge-tts メイン（非公式リスク許容）／失敗時 Windows SAPI |
| 8 | UI | **JARVIS風HUDを最初から実装** |

---

## 2. 動作環境（実機）

| 項目 | 値 | 仕様への影響 |
|---|---|---|
| CPU | Intel Core i5-12400（6C/12T, 2.5–4.4GHz） | STT/CPU推論の実用速度は確保。OllamaはGPU推論前提 |
| GPU | NVIDIA RTX 3060 Ti **VRAM 8GB** | 7B〜9Bクラス（Q4）が全載せ可能。14Bは部分オフロード |
| RAM | 48GB以上（GPU共有メモリ表示 47.8GB） | モデル入替・複数プロセス同時実行に余裕 |
| OS | Windows（WebView2 必須） | Tauriの前提 |

### 2.1 推奨モデル構成（VRAM 8GB前提）

| 用途 | モデル | 概算VRAM | 備考 |
|---|---|---|---|
| LLM（標準） | `qwen2.5:7b-instruct` (Q4_K_M) | 約4.7GB | 日本語が実用レベル。応答速度 30–50 tok/s 目安 |
| LLM（高品質） | `gemma2:9b` (Q4) | 約5.8GB | 日本語○。whisperと同時使用時は要注意 |
| LLM（重量級） | 14Bクラス (Q3_K_M) | 約7.5GB+部分オフロード | 速度低下。常用は非推奨 |
| 埋め込み（将来） | `nomic-embed-text` | 約0.3GB | RAG用 |
| STT | whisper.cpp `medium`（CUDA） | 約2GB | 精度優先。`small` は約1GBで高速 |
| TTS | edge-tts `ja-JP-NanamiNeural` | 0（クラウド） | オフライン時 `ja-JP-KeitaNeural`→SAPI |

- **VRAM配分の目安**: LLM 4.7GB ＋ whisper 1–2GB ＝ 6.7GB → 8GBに収まる
- 同時利用が厳しい場合は「LLM応答中はSTTを一時停止」する排他制御を入れる

---

## 3. アーキテクチャ

```
┌──────────────────────────── WebView2 (React 19 + TS) ────────────────────────────┐
│  HUD表示 / チャット / 設定 / 履歴        Web Audio API（録音・VAD・再生）        │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │ Tauri IPC（invoke / event）
┌───────────────────────────────┴──────────────────────────────────────────────────┐
│ src-tauri (Rust: 薄いブリッジ)                                                    │
│  commands/  chat_stream | stt | tts | history | settings | window                │
│  providers/ openai_compat(Gemini互換/Ollama/Groq)                                │
│  speech/    whisper.cpp サイドカー起動, edge-tts 呼び出し, SAPIフォールバック      │
│  db/        SQLite（rusqlite + マイグレーション）                                 │
│  system/    トレイ / グローバルホットキー / オーバーレイ / 自動起動                │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 プロバイダ抽象化
- 共通インターフェース: `Provider { id, stream_chat(messages, opts) -> Stream<Chunk> }`
- 実装は **OpenAI互換 `/chat/completions`（SSE）** を基本形にする
  - Gemini → `generativelanguage.googleapis.com` のOpenAI互換エンドポイント
  - Ollama → `http://localhost:11434/v1`
  - Groq / OpenRouter → OpenAI互換
- フォールバック順（設定可）: `Gemini → Ollama`（レート制限・失敗時に切替）

### 3.2 データモデル（SQLite）
| テーブル | 主な列 |
|---|---|
| `threads` | id, title, system_prompt, created_at, updated_at, pinned |
| `messages` | id, thread_id, role, content, provider, model, tokens, created_at |
| `settings` | key, value（DPAPI暗号化した秘匿値は別カラム or 別テーブル） |
| `secrets` | key, encrypted_value（DPAPI） |

---

## 4. UI仕様（JARVIS風HUD）

### 4.1 デザイントークン
| 要素 | 値 |
|---|---|
| 背景 | `#06090F`（ベース）／`#0D131C`（パネル） |
| アクセント | `#00E5FF`（シアン発光）／`#7CF9FF`（ハイライト） |
| 警告/エラー | `#FF5C5C` |
| 文字 | `#E6F1FF`（主）／`#8FA3B8`（副） |
| フォント | UI: `Segoe UI Variable` / コード: `Cascadia Code` |
| 効果 | 外周リング（回転アニメ）、波形バー、ガラス風ブラー、走査線（任意・OFF可） |

### 4.2 画面構成
1. **メインウィンドウ**（1200×800 既定、リサイズ可）
   - 左: スレッド一覧（検索・ピン留め）
   - 中央: チャット（ストリーミング、Markdown、コードハイライト）
   - 右: 折りたたみ式インスペクタ（モデル・トークン数・使用プロバイダ）
   - 下部: 入力欄＋マイクボタン＋送信（Enter送信 / Shift+Enter改行）
2. **オーバーレイHUD**（透過・常時最前面・小型 360×180）
   - 中央に回転リング＋状態（待機/録音/思考中/発話中）
   - 直近応答の字幕、波形、ミュート・閉じるボタン
   - ドラッグ移動・位置記憶、クリックスルー切替（任意）
3. **トレイメニュー**: 表示/非表示、HUD切替、ミュート、設定、終了

### 4.3 状態遷移（HUD）
`Idle → Listening（VAD検出） → Thinking（LLMストリーム中） → Speaking（TTS再生） → Idle`
- 状態に応じてリング色・回転速度・波形表示を変化させる

---

## 5. 機能要件

| ID | 機能 | 概要 | フェーズ |
|---|---|---|---|
| FR-01 | テキストチャット | ストリーミング表示、Markdown、コードハイライト | P1 |
| FR-02 | プロバイダ/モデル切替 | 設定画面。システムプロンプト編集。フォールバック順設定 | P1 |
| FR-03 | 会話履歴 | スレッド管理・検索・ピン留め・JSON/MDエクスポート | P1 |
| FR-04 | 音声入力 | ホットキー（既定 `Ctrl+Alt+Space`）で録音→STT→送信 | P2 |
| FR-05 | 音声出力 | 応答を文単位でTTS再生。速度/音量/ミュート | P2 |
| FR-06 | 常駐UI | トレイ常駐、オーバーレイHUD、起動時最小化 | P3 |
| FR-07 | ハンズフリー会話 | VADで自動ターン交代（ウェイクワードは任意・後回し） | P3 |
| FR-08 | 添付 | 画像/PDF/テキスト（Vision対応モデルのみ） | P4 |
| FR-09 | 長期記憶 | ユーザープロファイル・メモの自動注入 | P4 |
| FR-10 | ツール実行 | Web検索・ファイル操作・アプリ起動（Function Calling） | P5 |

---

## 6. 非機能要件

- **応答開始**: クラウド 1.5秒以内 / ローカル 3秒以内（7B Q4目安）
- **音声ターン検出**: 300ms 以内（VAD、無音0.8秒で確定）
- **常駐メモリ**: 250MB以下（WebView2共有）
- **オフライン**: Ollama + whisper.cpp + SAPI で全機能動作
- **秘匿性**: APIキーはDPAPI暗号化。外部送信は選択中プロバイダのみ
- **ログ**: 会話本文・APIキーをログに残さない（レベル: INFO以上）
- **安定性**: LLM/TTS失敗時はUIを落とさずエラートースト＋フォールバック

---

## 7. リスクと対策

| リスク | 対策 |
|---|---|
| edge-tts の仕様変更（非公式） | TTS層をインターフェース化。SAPI/Piperへ差し替え可能に |
| WebView2 のマイク権限 | Tauriのcapability設定と初回権限ダイアログを実装・検証 |
| VRAM 8GB の競合（LLM＋whisper） | 排他制御。whisper は `small` に落とせる設定を用意 |
| Gemini無料枠のレート制限 | 429検知でOllamaへ自動フォールバック＋UIに表示 |
| whisper.cpp のCUDAビルド | ビルド済みバイナリを `src-tauri/binaries/` に配置。CPU版をフォールバックに用意 |
| 常時最前面HUDの邪魔さ | クリックスルー、透過度、自動非表示（フォーカス喪失時）を設定可能に |

---

## 8. 開発フェーズと完了条件

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| **P0** | 環境構築・Tauri雛形・HUDスケルトン | `npm run tauri dev` でHUD風ウィンドウが起動 |
| **P1** | テキストチャット（Gemini→Ollama）＋履歴保存 | ストリーミング応答、スレッド切替、再起動後も履歴保持 |
| **P2** | 音声入力（whisper.cpp）＋音声出力（edge-tts/SAPI） | ホットキー→発話→応答読み上げが通しで動作 |
| **P3** | 常駐・トレイ・オーバーレイ・VADハンズフリー | トレイから呼び出し、HUDだけで会話が完結 |
| **P4** | 添付・長期記憶 | 画像質問、プロファイル注入が動作 |
| **P5** | ツール実行 | Function Callingで1つ以上のツールが動作 |

### P0 タスク分解
1. Node.js / Rust(MSVC) / WebView2 の確認
2. `npm create tauri-app` で React+TS テンプレート作成
3. Tailwind CSS / shadcn/ui / framer-motion 導入
4. デザイントークン（§4.1）をCSS変数として定義
5. メインウィンドウの3ペインレイアウト＋HUDオーバーレイの静的モック
6. トレイ・グローバルホットキー・複数ウィンドウのプラグイン導入
7. `npm run tauri dev` と `tauri build` の動作確認

---

## 9. ディレクトリ構成

```
JARVIS/
├─ src/                          # React（フロントエンド）
│  ├─ app/                       # ルーティング・レイアウト
│  ├─ features/chat/
│  ├─ features/voice/
│  ├─ features/history/
│  ├─ features/settings/
│  ├─ features/hud/              # オーバーレイ用UI（状態遷移・リング・波形）
│  ├─ shared/                    # UI部品・テーマ・型
│  └─ lib/ipc/                   # Tauriコマンドのラッパ
├─ src-tauri/
│  ├─ src/{commands,providers,speech,db,system}/
│  ├─ binaries/                  # whisper.cpp 等
│  ├─ capabilities/
│  └─ tauri.conf.json
├─ logs/                         # 仕様ドラフト・開発ログ
└─ SPEC.md                       # 本ファイル
```

---

## 10. 決定ログ（今回の回答）

1. Rustは薄いブリッジのみ → 確定
2. 抽象化 → Geminiで即確認 → Ollama追加 → 確定
3. edge-tts メイン（非公式リスク許容） → 確定
4. JARVIS風HUDを最初から → 確定
5. 実機スペック（i5-12400 / RTX 3060 Ti 8GB / RAM 48GB+）→ モデル選定（§2.1）に反映
