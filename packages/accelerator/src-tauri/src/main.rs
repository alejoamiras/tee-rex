// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bb;
mod server;

use server::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Returns the log directory: `~/Library/Application Support/tee-rex-accelerator/logs/` (macOS).
pub fn log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tee-rex-accelerator")
        .join("logs")
}

fn main() {
    let log_path = log_dir();
    std::fs::create_dir_all(&log_path).ok();

    let file_appender = tracing_appender::rolling::daily(&log_path, "accelerator.log");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(fmt::layer().with_writer(std::io::stdout))
        .with(fmt::layer().with_writer(file_writer).with_ansi(false))
        .init();

    tracing::info!(log_dir = %log_path.display(), "Logging initialized");

    tauri::Builder::default()
        .setup(|app| {
            let status = MenuItemBuilder::with_id("status", "Status: Idle")
                .enabled(false)
                .build(app)?;
            let show_logs = MenuItemBuilder::with_id("show_logs", "Show Logs").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&status, &show_logs, &quit])
                .build()?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("TeeRex Accelerator")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show_logs" => {
                        let dir = log_dir();
                        #[cfg(target_os = "macos")]
                        {
                            let _ = std::process::Command::new("open").arg(&dir).spawn();
                        }
                        #[cfg(target_os = "linux")]
                        {
                            let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
                        }
                        #[cfg(target_os = "windows")]
                        {
                            let _ = std::process::Command::new("explorer").arg(&dir).spawn();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            let status_clone = status.clone();
            let tray_clone = tray.clone();
            let state = AppState {
                on_status: Some(Arc::new(move |text: &str| {
                    let _ = status_clone.set_text(text);
                    let _ = tray_clone.set_tooltip(Some(text));
                    // macOS: show text next to the tray icon in the menu bar
                    if text.contains("Proving") {
                        let _ = tray_clone.set_title(Some("Proving..."));
                    } else {
                        let _ = tray_clone.set_title(Some(""));
                    }
                })),
            };

            // Spawn the HTTP server on the Tokio runtime
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(state).await {
                    tracing::error!("Accelerator server error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TeeRex Accelerator");
}
