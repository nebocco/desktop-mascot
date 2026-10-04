# Backlog

issueを立てるほどでもない積み残しを記録する。既知の限界、後回しにした判断、軽微な整理が対象。issueと重複させない。

## PR #2 のレビューで見つかった積み残し

いずれもPR #2「フェーズ2: 設定機能の実装」のコードレビューで挙がったlow相当の指摘。同PRでは1〜3(medium)のみ修正した。

### `GDK_BACKEND` の判定が完全一致のみ

`src-tauri/src/lib.rs` の `positioning_supported_on_linux` は `gdk_backend == Some("x11")` で判定している。GTKが受け付ける `GDK_BACKEND=x11,wayland`(フォールバック付き)や大文字表記 `X11` にはマッチしない。Waylandセッションでこれらを指定して起動すると、実際にはXwayland上で座標指定が機能するにもかかわらず位置の適用も保存も無効化される。先頭要素を取り出して大文字小文字を無視して比較すればよい。

`pnpm dev:x11` が渡すのは `GDK_BACKEND=x11` なので、標準の起動経路では問題にならない。

### ドラッグ中のホットパスで毎イベントIPCログを送っている

`src/App.vue` の `onMoved` ハンドラ内の `log.debug("onMoved fired", ...)` は無条件に実行され、`createLogger` はレベルによる間引きなしに毎回 `invoke("log_frontend", ...)` を呼ぶ。ドラッグ中 `onMoved` は60Hz前後で発火するため、保存を間引くために入れたdebounceの意図に反してIPC往復が発生し続ける。フロント側でレベルゲートするか、このログをdebounce後に移す。

### opacityがマスコットだけでなく設定ボタンにも掛かる

`src/App.vue` の `:style="{ opacity: mascotOpacity }"` は `.settings-btn` を内包する `.mascot-container` に適用されている。設定ウィンドウのOpacityスライダーは `:min="0"` なので0に振り切るとマスコットも設定ボタンも完全に不可視になる。メインウィンドウは装飾なし・タスクバー非表示のため、`settings.json` の手編集以外に復帰手段がなくなる。opacityを画像要素だけに掛けるか、スライダーの下限を0.1程度にする。

## フェーズ3（アニメーション機能）の積み残し

### WindowsとmacOSは未コンパイル・未実行

開発環境がWSL2のため、`src-tauri/src/animation/key_source.rs` のmacOS専用行（`rdev::set_is_main_thread(false)`）は一度もコンパイルされていない。Windowsでの動作も未確認。CIで両OSの `cargo check` を回すと早く解消できる。

### Windowsで `rdev::listen` がほかのアプリの入力に干渉する可能性

Windowsでは `rdev::listen` がキー押下ごとに前面ウィンドウのスレッドへ `AttachThreadInput` し、`ToUnicodeEx` を呼ぶ。デッドキーを使う配列やIMEの入力が、ほかのアプリで乱れる可能性がある(未検証)。Windowsの実機確認で「ほかのアプリでの入力(IME、デッドキー)が乱れないこと」を確かめる。

### `rdev` がgit依存になっている

`rdev` はcrates.io版ではなく、上流リポジトリの固定コミットへのgit依存にしている。macOSの修正がcrates.ioにリリースされたら、通常の依存に戻す。

### 入力中に `idleTimeout` を短くしても、進行中の待ちが終わるまで効かない

`src-tauri/src/animation/runner.rs` のループは、待機中に設定が更新されても現在の待ちが終わるまで新しい値を使わない。遅れは1回だけで最大5秒。直すなら、設定の更新時に待機中のループを起こす。

### `runner.rs` のテストが実時間スリープに依存している

`alternates_on_keys_and_returns_to_idle_after_the_timeout` は200msの実時間スリープに依存する。負荷の高い環境で不安定になりうる。

### 設定の連続保存で古い画像が表示されうる

設定の保存が短時間に連続すると、`src/App.vue` の `applySettings` の画像読み込みが前後して、古い設定の画像で上書きされうる。以前からある競合で、3枚読み込むようになって少し広がった。

### 検知が黙って効かない場合はログが出ない

XwaylandのあるWaylandセッションでは `rdev::listen` はエラーを返さず、ネイティブWaylandアプリの入力が見えないだけになる。このためログも出ない。検知できていないことを利用者に伝える手段がない。
