# アーキテクチャ方針

すべての機能を `[Input/Storage] → [Logic] → [Output/Storage]` の 3 ゾーンに分離する（必須）。

```
src-tauri/src/<feature>/
├── commands.rs     # #[tauri::command] エントリ（薄い wrapper + _inner）
├── logic.rs        # 純粋関数（self / I/O なし、cargo test で直接テスト）
├── repository.rs   # ファイル I/O（設定 JSON・画像）
└── mod.rs          # 型定義
```

`commands.rs` / `repository.rs` は薄く保ち、3 行以上の計算・条件分岐・データ変換は `logic.rs` の純粋関数に切り出す。これにより `MockRuntime` を使わずに `cargo test` で検証できる範囲が広がる。フロントも同様に、Tauri 通信を `src/api/*.ts` に集約し、表示用の変換は純粋関数に出す。
