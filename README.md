# デスクトップマスコット with Tauri + Vue

キーボード入力に応じてアニメーションするデスクトップマスコットアプリケーションです。

## 主な機能

- 透明背景・フレームレス・常に最前面のマスコットウィンドウ
- キーボード入力に反応するタイピングアニメーション（2枚の画像を交互に表示）
- 設定ウィンドウによるカスタマイズ
  - マスコット画像の登録（PNG形式）
  - アニメーション速度の調整（50〜500ms/フレーム）
  - ウィンドウ位置・透明度の設定
- 設定のローカルファイルへの永続化（次回起動時に自動復元）

## 技術スタック

- [Tauri 2](https://tauri.app/)（Rustバックエンド）
- [Vue 3](https://vuejs.org/) + TypeScript
- [PrimeVue](https://primevue.org/)（UIコンポーネント）
- Vite / pnpm

## セットアップ

事前にRustツールチェイン、Node.js、pnpm、および[Tauriの必須依存パッケージ](https://tauri.app/start/prerequisites/)をインストールしてください。

```sh
pnpm install
```

## 開発コマンド

| コマンド | 説明 |
| --- | --- |
| `pnpm tauri dev` | アプリを開発モードで起動 |
| `pnpm build` | フロントエンドの型チェックとビルド |
| `pnpm tauri build` | アプリのリリースビルド |
| `pnpm test` | Rustバックエンドのユニットテスト（`cargo test`） |

## ドキュメント

- アプリの仕様: [docs/specification.md](docs/specification.md)
- 開発タスク一覧: [docs/tasks.md](docs/tasks.md)
