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
| ネイティブ | Rust（薄いブリッジのみ） |

## 開発

```powershell
npm install
npm run tauri dev
```

Rust の `cargo` が PATH に無い場合は `%USERPROFILE%\.cargo\bin` を追加してください。

## ビルド（exe 作成）

```powershell
npm run tauri build
```

- exe: `src-tauri/target/release/jarvis.exe`
- インストーラ: `src-tauri/target/release/bundle/nsis/JARVIS_0.1.0_x64-setup.exe`

## 現在の状態（P0 完了）

- メインウィンドウ: スレッド一覧 / チャット / インスペクタの3ペイン骨格
- HUD オーバーレイ: 透過・最前面・状態アニメーション（`Ctrl + Alt + Space` で切替）
- トレイ常駐: 表示 / HUD 切替 / 終了
- チャットは UI 検証用のモック応答（モデル接続は P1）

| フェーズ | 内容 | 状態 |
|---|---|---|
| P0 | 環境構築・雛形・HUD 骨格 | 完了 |
| P1 | テキストチャット（Gemini → Ollama）＋履歴保存 | 未着手 |
| P2 | 音声入力（whisper.cpp）＋音声出力（edge-tts/SAPI） | 未着手 |
| P3 | 常駐・トレイ・VAD ハンズフリー | 一部（トレイ/HUD のみ） |
| P4 | 添付・長期記憶 | 未着手 |
| P5 | ツール実行 | 未着手 |

## ディレクトリ

```
src/                      # フロントエンド
  app/                    # アプリシェル
  features/chat/          # チャットUI・モック応答
  features/hud/           # HUD オーバーレイ
  shared/                 # 型・テーマトークン
  lib/ipc/                # Tauri コマンド呼び出し
src-tauri/                # Rust 側（Tauri）
logs/                     # 仕様ドラフト
```
