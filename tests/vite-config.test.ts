// @vitest-environment node
// viteのimportはjsdom環境だとesbuildの起動チェックに失敗するためnodeで実行する
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, test } from "vitest";
import viteConfigExport from "../vite.config";

describe("vite MPA configuration", () => {
  // publicDir配下のHTMLをrollup入力にすると、処理済みHTMLがdist/public/に
  // 出力され、dist直下には未処理のコピーが置かれて本番で真っ白になるため、
  // 入力はプロジェクトルート直下を指していなければならない
  test("settings entry points to root-level settings.html outside publicDir", async () => {
    const config =
      typeof viteConfigExport === "function"
        ? await viteConfigExport({ command: "build", mode: "production" })
        : viteConfigExport;

    const input = config.build?.rollupOptions?.input as Record<string, string>;
    expect(input).toBeDefined();
    expect(input.settings).toBe(resolve(__dirname, "..", "settings.html"));
    expect(input.settings).not.toContain(`${sep}public${sep}`);
    expect(existsSync(input.settings)).toBe(true);
    expect(
      existsSync(resolve(__dirname, "..", "public", "settings.html")),
    ).toBe(false);
  });
});
