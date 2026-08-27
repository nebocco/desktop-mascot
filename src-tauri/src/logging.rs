use tauri::Manager;
use tracing::{debug, info};
use tracing_subscriber::{fmt, EnvFilter};

/// Initializes the tracing subscriber that prints diagnostics to stderr.
///
/// The level can be overridden with `RUST_LOG`.
pub fn init() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("desktop_mascot_lib=debug,frontend=debug,info"));
    // すでに初期化済みでもアプリを止めないよう、戻り値のエラーは無視する
    let _ = fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_writer(std::io::stderr)
        .try_init();
}

/// Logs the windowing-backend environment and the main window's real
/// geometry, so mismatches between requested and actual state are visible.
pub fn log_window_environment(app: &tauri::AppHandle) {
    for key in [
        "XDG_SESSION_TYPE",
        "WAYLAND_DISPLAY",
        "DISPLAY",
        "GDK_BACKEND",
    ] {
        info!(
            key,
            value = std::env::var(key).unwrap_or_else(|_| "<unset>".into()),
            "windowing environment"
        );
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    debug!(
        outer_position = ?window.outer_position(),
        inner_size = ?window.inner_size(),
        outer_size = ?window.outer_size(),
        scale_factor = ?window.scale_factor(),
        is_always_on_top = ?window.is_always_on_top(),
        "main window geometry at startup"
    );
}

/// Level of a log record forwarded from a webview.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrontendLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Forwards a webview log record to the terminal, so both frontend and
/// backend diagnostics appear in a single stream.
#[tauri::command]
pub fn log_frontend(level: FrontendLevel, scope: String, message: String) {
    match level {
        FrontendLevel::Debug => tracing::debug!(target: "frontend", scope, "{message}"),
        FrontendLevel::Info => tracing::info!(target: "frontend", scope, "{message}"),
        FrontendLevel::Warn => tracing::warn!(target: "frontend", scope, "{message}"),
        FrontendLevel::Error => tracing::error!(target: "frontend", scope, "{message}"),
    }
}
