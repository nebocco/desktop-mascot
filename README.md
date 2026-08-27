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
| `pnpm dev:x11` | X11バックエンドを強制してアプリを開発モードで起動（Wayland/WSLg環境ではこちら） |
| `pnpm build` | フロントエンドの型チェックとビルド |
| `pnpm tauri build` | アプリのリリースビルド |
| `pnpm test` | Rustバックエンドのユニットテスト（`cargo test`） |

## Wayland環境での制約

Waylandプロトコルにはクライアントが自分のウィンドウの絶対座標を知る・指定する手段がありません。そのため、Waylandセッション（WSLgのデフォルトを含む）でそのまま起動すると次の制約を受けます。

- ウィンドウ位置の指定が無視される（`setPosition`が効かない）
- 常に最前面表示が効かない（xdg-shellに相当機能がない）
- 実際には移動していなくてもウィンドウ位置が`(0, 0)`として報告される

アプリはこの状況を起動時に検出し、位置の適用と保存を自動的に停止します（保存済みの位置が`(0, 0)`で上書きされるのを防ぐため）。位置指定と常に最前面表示を使うには、Xwayland経由で起動してください。

```sh
pnpm dev:x11
# あるいは
GDK_BACKEND=x11 pnpm tauri dev
```

リリースビルドを起動する場合も同様に`GDK_BACKEND=x11`を付けてください。

## ドキュメント

- アプリの仕様: [docs/specification.md](docs/specification.md)
- 開発タスク一覧: [docs/tasks.md](docs/tasks.md)
