# アップデート情報

このフォルダがローカルのアップデート情報の置き場です。
アプリは起動時と設定画面を開いたときに `latest.json` を探し、
新しいバージョンがあれば「更新」ボタンを表示します。

## 参照される順序

1. 環境変数 `JARVIS_UPDATE_DIR`
2. `<exe と同じフォルダ>\updates`
3. `<exe>\..\..\..\updates`（リポジトリ直下。`target/debug|release` から実行時）
4. `<インストール先>\updates`（`usr` の親）
5. `<データフォルダ>\updates`

最初に見つかった `latest.json` が使われます。

## リリース手順

1. バージョンを上げる
   - `src-tauri/tauri.conf.json` の `version`
   - `src-tauri/Cargo.toml` の `version`
   - `package.json` の `version`
2. `npm run tauri build` でビルド
3. インストーラをこのフォルダへコピー
   - 例: `updates/JARVIS_0.2.0_x64-setup.exe`
4. `latest.json` を更新

```json
{
  "version": "0.2.0",
  "releasedAt": "2026-12-01",
  "notes": "音声認識の精度改善",
  "installer": "JARVIS_0.2.0_x64-setup.exe",
  "url": ""
}
```

5. アプリの設定 → アップデート → 「再確認」→「インストーラを起動」

## 補足

- `installer` は `latest.json` からの相対パス（または絶対パス）です。
- アプリはインストーラ起動後に自動終了します。
- データ（`usr` フォルダ）はインストール先に残るため、更新しても会話履歴は保持されます。
- インストーラ本体（`*.exe`）は容量が大きいため Git 管理外（`.gitignore`）です。
