# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

A desktop mascot application built with Tauri 2 and Vue 3. A mascot image sits on the desktop in a transparent, frameless, always-on-top window and animates in response to the user's keyboard input. A separate settings window lets the user register mascot images, tune animation speed, and persist settings.

## Architecture

Two-window Tauri app:

- **Main window** (label `main`): frameless, skips the taskbar; size (default 200x200), position, and always-on-top are applied from saved settings at startup. Defined in `src-tauri/tauri.conf.json`. Frontend entry is `src/main.ts` mounting `src/App.vue`.
- **Settings window**: normal resizable window built with PrimeVue components. Frontend entry is `src/settings.ts` mounting `src/SettingsWindow.vue`.

Key locations:

- `src-tauri/src/lib.rs` — Rust backend: `Settings` struct (serde, camelCase rename to match the frontend), Tauri commands for loading/saving settings as JSON in the app config directory, and the unit tests.
- `src/types/settings.ts` — TypeScript counterparts of the settings types (`Settings`, `WindowPosition`, `WindowSize`, `ImagePaths`). Keep these in sync with the Rust structs.
- `src-tauri/src/png.rs` — hand-rolled PNG signature/IHDR validation (512px dimension cap)
- `src-tauri/src/images.rs` — image registration/loading commands; copies validated PNGs into the app data `images/` dir under fixed names
- `src/components/ImageSlot.vue` — image slot UI (preview, select, clear) used by the settings window
- `src/windowSettings.ts` — applies persisted settings to the native main window
- PrimeVue components are auto-imported via `unplugin-vue-components` (see `vite.config.ts`, generated `components.d.ts`).

Windows communicate through the Tauri event system; settings changes propagate from the settings window to the main window, and main-window drag positions propagate back.

## 開発方針

superpowers skill の設計に従う。実装の着手前に spec と plan を作成し、実装フェーズは Subagent-Driven に行う。各スキルが定めるアーティファクトを省略せず、順序も飛ばさない。省略する場合は理由を設計ドキュメントに書く。

新規の設計・計画ドキュメントは `docs/spec/`,  `docs/plan/` 配下に日付プレフィックス付き(`YYYY-MM-DD-<topic>.md`)で置く。`docs/` 直下や `docs/superpowers/`, 機能別ディレクトリには置かない。`docs/archive/` は参照専用の歴史的記録なので更新しない。


## 機械チェックとの付き合い方

リポジトリルートの `.pre-commit-config.yaml` が prek 経由で commit 時に自動実行される。対象は `mock_app_tauri/` 配下で、`cargo fmt --check` / `cargo clippy --all-targets --features dev-tools -- -D warnings` / `cargo test --features dev-tools` / 変更ファイルへの `#[cfg(test)]` 強制 / コメント自己完結チェック / `biome check` / `vue-tsc --noEmit` / `vitest run` / gitleaks が走る。

- **これらを手動で実行する必要はない。** フックが門番なので、通らなければ commit が落ちる。落ちたら直して再度 commit すればよい
- **コードレビューでこれらの規約を検証する必要はない。** 実装者のコミットが存在するならフックは通っている。レビューは仕様や意味論、実際のコード動作に集中する
- フックが走ったかの確認が必要なら、ブランチ全体に対して `prek run -a` あるいは `prek run --from-ref <FROM_REF> --to-ref <TO_REF>` を実行する
- **`src-tauri/` を触るコミットは cargo test を含むため 2 分では終わらない。** commit や `prek run` を実行するときはタイムアウトを長め（10 分程度）に取る。途中で切ると退避された変更が失われる

## コマンド

**パッケージマネージャは `pnpm` 固定。** `tauri.conf.json` の `beforeDevCommand` / `beforeBuildCommand` が `pnpm dev` / `pnpm build` を直接呼ぶため、npm / yarn では Tauri 側から起動できない。

```bash
pnpm dev                 # フロント単体
pnpm tauri dev           # アプリ起動（フロントも自動で立ち上がる）
pnpm build               # vue-tsc --noEmit && vite build
pnpm tauri build

cd src-tauri
# dev-tools feature の後ろにダミーデータ生成バイナリが隠れている。付けないと
# そのバイナリがターゲットから外れ、検査されないまま通ってしまう
cargo test --features dev-tools
cargo test <テスト名> --features dev-tools -- --nocapture
```

## アーキテクチャ

すべての機能を `[Input/Storage] → [Logic] → [Output/Storage]` の 3 ゾーンに分離する（必須）。

```
src-tauri/src/<feature>/
├── commands.rs     # #[tauri::command] エントリ（薄い wrapper + _inner）
├── logic.rs        # 純粋関数（self / I/O なし、cargo test で直接テスト）
├── repository.rs   # DB I/O（sqlx）
└── mod.rs          # 型定義
```

`commands.rs` / `repository.rs` は薄く保ち、3 行以上の計算・条件分岐・データ変換は `logic.rs` の純粋関数に切り出す。これにより `MockRuntime` を使わずに `cargo test` で検証できる範囲が広がる。フロントも同様に、Tauri 通信を `src/api/*.ts` に集約し、表示用の変換は純粋関数に出す。

## テスト

層 1: Vue / composable（Vitest + `@vue/test-utils`、`vi.mock("@tauri-apps/api/core")` で `invoke` をスタブ）／層 2: Rust 純粋関数（`cargo test`）／層 3: `#[tauri::command]` 統合（`tauri::test::MockRuntime`）／層 4: アプリ E2E（`tauri-driver` + WebdriverIO、現時点では実施しない）。

- **層 2 を最も厚くする。** command のロジックを純粋関数に切り出し、層 3 は薄く保つ
- **Playwright は Tauri の WebView を駆動できない**（Windows: WebView2 / Linux: WebKitGTK / macOS: WKWebView）。実バイナリの E2E は `tauri-driver` 一択
- ファイル選択ダイアログ等の OS ネイティブ UI は WebDriver から操作できない
