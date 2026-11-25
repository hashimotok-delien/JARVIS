# アップデート情報

このフォルダがローカルのアップデート情報の置き場です。
アプリは起動時と設定画面を開いたときに `latest.json` を探し、
新しいバージョンがあれば「更新」ボタンを表示します。

## 参照される順序

1. 設定 → アップデート の「更新元フォルダ」（ここで指定したフォルダが最優先）
2. 環境変数 `JARVIS_UPDATE_DIR`
3. ビルド時のリポジトリ直下 `updates` フォルダ
4. `<exe と同じフォルダ>\updates`
5. `<exe>\..\..\..\updates`（開発ビルド時のリポジトリ直下）
6. `<インストール先>\updates`（`usr` の親）
7. `<データフォルダ>\updates`

最初に見つかった `latest.json` が使われます。
「更新元を監視」を有効にすると、設定した間隔（既定60秒）で
`latest.json` とインストーラの有無を自動確認します。
また、開発リポジトリの `updates\latest.json` を更新すると、
同じPCにインストール済みのアプリでも「再確認」から更新を検出できます。
ただし、v0.2.0より前のアプリはリポジトリ内フォルダを確認しないため、
最初のv0.2.0への更新はインストーラを手動で実行してください。

## リリース手順

1. バージョンを上げる
   - `src-tauri/tauri.conf.json` の `version`
   - `src-tauri/Cargo.toml` の `version`
   - `package.json` の `version`
2. `npm run tauri build` でビルド
3. インストーラをこのフォルダへコピー
   - 例: `updates/JARVIS_0.4.0_x64-setup.exe`
4. `latest.json` を更新

```json
{
  "version": "0.4.0",
  "releasedAt": "2026-11-25",
  "notes": "音声認識をspeech.cpp + Haas-ja-v1.0に刷新",
  "installer": "JARVIS_0.4.0_x64-setup.exe",
  "url": ""
}
```

5. アプリの設定 → アップデート → 「再確認」→「インストーラを起動」

## 補足

- `installer` は `latest.json` からの相対パス（または絶対パス）です。
- アプリはインストーラ起動後に自動終了します。
- データ（`usr` フォルダ）はインストール先に残るため、更新しても会話履歴は保持されます。
- インストーラ本体（`*.exe`）は容量が大きいため Git 管理外（`.gitignore`）です。
