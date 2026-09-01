import { invoke } from "@tauri-apps/api/core";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Forwards a log record to the Rust backend so webview diagnostics appear
 * in the same terminal stream as backend logs.
 *
 * Failures are swallowed: logging must never break the caller.
 */
function forward(level: Level, scope: string, message: string): void {
  try {
    // バックエンドが未接続でもフロントの処理は続行させる
    void invoke("log_frontend", { level, scope, message }).catch(() => {});
  } catch {
    // Tauriランタイム外(テスト環境など)では転送を諦める
  }
}

function format(scope: string, message: string, data?: unknown): string {
  return data === undefined
    ? `[${scope}] ${message}`
    : `[${scope}] ${message} ${JSON.stringify(data)}`;
}

/**
 * Creates a scoped logger that writes to both the webview console and the
 * backend terminal.
 */
export function createLogger(scope: string) {
  const emit = (level: Level, message: string, data?: unknown) => {
    const line = format(scope, message, data);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
    forward(
      level,
      scope,
      data === undefined ? message : `${message} ${JSON.stringify(data)}`,
    );
  };

  return {
    debug: (message: string, data?: unknown) => emit("debug", message, data),
    info: (message: string, data?: unknown) => emit("info", message, data),
    warn: (message: string, data?: unknown) => emit("warn", message, data),
    error: (message: string, data?: unknown) => emit("error", message, data),
  };
}
