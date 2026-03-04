// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bb;
mod server;

use server::AppState;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            let status = MenuItemBuilder::with_id("status", "Status: Idle")
                .enabled(false)
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app).items(&[&status, &quit]).build()?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("TeeRex Accelerator")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
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
                        let _ = tray_clone.set_title(None::<&str>);
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
