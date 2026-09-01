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
