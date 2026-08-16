# アプリを開発モードで起動する(デフォルト)
run:
    pnpm tauri dev

# Rust/TSのlintを実行する
lint:
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    pnpm exec biome check .

# Rust/TSのコードを整形する
format:
    cargo fmt --manifest-path src-tauri/Cargo.toml
    pnpm exec biome format --write .

# Rustバックエンドのユニットテストを実行する
test:
    cargo test --manifest-path src-tauri/Cargo.toml
