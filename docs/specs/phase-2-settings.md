# フェーズ2: 設定機能の実装 設計書

## 背景と目的

フェーズ1で設定ウィンドウのUI・設定の永続化（`settings.json`）・ウィンドウの基本構成は実装済みだが、以下が未実装である。

- 画像の検証・プレビュー・アプリ管理下への保存
- 設定変更のメインウィンドウへの反映（画像表示・透明度・位置・サイズ・alwaysOnTop）
- ウィンドウ間のイベント通信
- ドラッグ後のウィンドウ位置の自動保存と設定ウィンドウへの反映

フェーズ2ではこれらを実装し、「設定ウィンドウで行った変更が実際にマスコットの見た目・挙動に反映される」状態にする。

## スコープ判断（確定事項）

- 設定のメインウィンドウへの反映を**含める**（画像表示・透明度・位置・サイズ・alwaysOnTop・イベント通信）
- 画像はアプリ管理下（appDataDir）へ**コピー**して管理する
- 対応画像形式は**PNGのみ**（JPG/GIFはフェーズ5で拡張）
- 幅・高さのいずれかが512pxを超える画像は**拒否してエラー表示**（自動縮小はしない）
- 設定の反映タイミングは**保存ボタン押下時**（リアルタイムプレビューはフェーズ4.3で対応）
- アニメーションはフェーズ3のため、メインウィンドウでは**アイドル画像の静止表示**まで
- 画像処理（検証・コピー・base64変換）は**Rust側に集約**する（追加プラグイン不要、ケーパビリティ変更最小、ユニットテスト容易）

## 全体構成とデータフロー

設定の永続化は従来通り`settings.json`（appConfigDir）。画像はappDataDir配下の`images/`ディレクトリに固定名（`typing1.png` / `typing2.png` / `idle.png`）でコピーし、`settings.images`にはコピー先の絶対パスを保存する。固定名の上書きコピーにより、古いファイルの掃除は不要になる。

反映フロー:

1. 設定ウィンドウで画像選択 → `register_image`コマンドが検証+コピー → 返ってきたパスを設定モデルに反映し、プレビューを更新
2. Saveボタン → `save_settings` → 成功後にイベント`settings-updated`（ペイロード: `Settings`全体）をemit
3. メインウィンドウが`settings-updated`を受けて反映:
   - アイドル画像の表示（静止表示）
   - 透明度（CSS opacity）
   - サイズ（`setSize`）・位置（`setPosition`）
   - alwaysOnTop（`setAlwaysOnTop`）
4. 起動時: メインウィンドウが`get_settings`を呼び、同じ適用処理を実行する（前回終了位置の復元を含む）

## Rustバックエンド（新規コマンド）

### `register_image(app, image_type: String, source_path: String) -> Result<String, String>`

- `image_type`は`typing1` / `typing2` / `idle`のみ許可。それ以外はエラー（コピー先ファイル名を許可リストで固定することでパス注入を防ぐ）
- 検証: PNGシグネチャ8バイト+IHDRチャンクからwidth/heightを読み取り、非PNG・寸法超過（幅または高さが512px超）・破損ファイルを拒否
- 検証・寸法読み取りは`validate_png(bytes) -> Result<(u32, u32), ...>`のような純関数に切り出し、ユニットテスト対象とする（画像クレートは追加しない）
- appDataDir配下に`images/`を作成し、固定名で上書きコピーしてコピー先の絶対パスを返す

### `load_image(app, path: String) -> Result<String, String>`

- パスがappDataDirの`images/`配下であることを検証してから読み込む（任意ファイル読み出しの防止）
- ファイル内容をbase64文字列で返す。フロントエンドは`data:image/png;base64,...`として`<img>`に渡す
- base64エンコードには`base64`クレートを追加する

### `save_window_position(app, x: i32, y: i32) -> Result<(), String>`

- 既存の`settings.json`を読み込み、`windowPosition`のみ更新して書き戻す
- 位置以外のフィールドは保持する（設定ウィンドウの未保存編集をSettings全体の保存で上書きしないための専用コマンド）

## 設定ウィンドウの変更

- 画像スロットUIを「パス表示+Selectボタン」から「プレビューサムネイル+Selectボタン+Clearボタン」に変更
  - 選択時: `register_image`を呼び、成功でプレビュー表示、失敗（形式・サイズ違反）はstatusMessageにエラー表示
  - Clear: 設定の該当パスを空文字にする（コピー済みファイルは残ってよい。次の登録時に上書きされる）
- ファイル選択ダイアログのフィルタをPNGのみに変更
- Save成功時に`emit("settings-updated", settings)`を追加
- メインウィンドウ発の`position-changed`イベントを受けて、位置フォームの表示値を更新

## メインウィンドウの変更

- 起動時に`get_settings`を呼び、設定を適用する。適用処理は`applySettings(settings)`関数に集約する
- `settings-updated`リスナーで同じ`applySettings`を実行
- マスコット表示: `settings.images.idle`が設定されていれば`load_image`で取得した画像を表示、なければ現在のプレースホルダー（🐱）を表示
- ドラッグ後の位置保存: ウィンドウの`onMoved`イベントを500ms程度でdebounceし、`save_window_position`で位置のみ永続化する。あわせて`position-changed`イベントをemitし、設定ウィンドウが開いていればフォームに反映する

## エラー処理

- 画像検証エラー: 種別ごとに明確なメッセージ（PNG形式ではない / 512x512を超えている / ファイルが読めない）を設定ウィンドウに表示する
- 起動時に画像パスが存在しない・読めない場合: プレースホルダー表示で継続する（アプリは落とさない）
- `load_image`のパス検証違反はエラーを返すのみとする

## テスト方針（TDD）

### Rust（cargo test）

- `validate_png`: 正常PNG / 寸法超過 / 非PNG / 切り詰められたファイル
- `image_type`の許可リスト検証
- `save_window_position`のマージ動作（位置以外のフィールドが保持されること）
- ケーパビリティ契約テストの更新（イベント通信に必要な権限が増える場合）

### フロントエンド（vitest）

- 画像スロットコンポーネントの表示分岐（プレビュー有無・エラー表示）
- `applySettings`のロジック（Tauri APIはモック）
- Save成功時に`settings-updated`がemitされること
- `position-changed`受信で位置フォームの値が更新されること

## 進め方

- ブランチ: developから`feature/phase-2-settings`を分岐
- コミットは都度ユーザー確認の上で行う
