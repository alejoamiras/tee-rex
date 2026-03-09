// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tee_rex_accelerator::log_dir;
use tee_rex_accelerator::server::AppState;
use tee_rex_accelerator::versions;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// Build a "Versions" submenu listing the bundled + cached bb versions.
fn build_versions_submenu(
    app: &AppHandle,
    bundled_version: &str,
) -> Result<tauri::menu::Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    let mut builder = SubmenuBuilder::with_id(app, "versions", "Versions");

    // Bundled version always first
    let bundled_item = MenuItemBuilder::with_id(
        format!("version_{bundled_version}"),
        format!("{bundled_version} (bundled)"),
    )
    .enabled(false)
    .build(app)?;
    builder = builder.item(&bundled_item);

    // Cached versions (exclude bundled to avoid duplicate)
    let cached = versions::list_cached_versions();
    for v in &cached {
        if v != bundled_version {
            let item = MenuItemBuilder::with_id(format!("version_{v}"), v.as_str())
                .enabled(false)
                .build(app)?;
            builder = builder.item(&item);
        }
    }

    Ok(builder.build()?)
}

fn main() {
    let log_path = log_dir();
    std::fs::create_dir_all(&log_path).ok();

    let file_appender = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("accelerator")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_path)
        .expect("failed to create log appender");
    let (file_writer, _guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stdout))
        .with(fmt::layer().with_writer(file_writer).with_ansi(false))
        .init();

    tracing::info!(log_dir = %log_path.display(), "Logging initialized");

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Hide from Dock — tray-only app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let bundled_version = env!("AZTEC_BB_VERSION").to_string();

            let status = MenuItemBuilder::with_id("status", "Status: Idle")
                .enabled(false)
                .build(app)?;

            let versions_submenu = build_versions_submenu(&app.handle().clone(), &bundled_version)?;

            let show_logs = MenuItemBuilder::with_id("show_logs", "Show Logs").build(app)?;

            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            if autostart_enabled {
                tee_rex_accelerator::crash_recovery::enable_crash_recovery();
            }
            let autostart = CheckMenuItemBuilder::with_id("toggle_autostart", "Start on Login")
                .checked(autostart_enabled)
                .build(app)?;

            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&status, &versions_submenu, &show_logs, &autostart, &quit])
                .build()?;

            let tray_icon = {
                let bytes = include_bytes!("../icons/tray-icon.png");
                tauri::image::Image::from_bytes(bytes).expect("failed to load tray icon")
            };

            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("TeeRex Accelerator")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
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
                    "toggle_autostart" => {
                        let manager = app.autolaunch();
                        let currently_enabled = manager.is_enabled().unwrap_or(false);
                        if currently_enabled {
                            let _ = manager.disable();
                            tee_rex_accelerator::crash_recovery::disable_crash_recovery();
                            let _ = autostart.set_checked(false);
                            tracing::info!("Auto-start on login disabled");
                        } else {
                            let _ = manager.enable();
                            tee_rex_accelerator::crash_recovery::enable_crash_recovery();
                            let _ = autostart.set_checked(true);
                            tracing::info!("Auto-start on login enabled");
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            let status_clone = status.clone();
            let tray_clone = tray.clone();

            // Versions changed callback: rebuild the Versions submenu when versions change
            let app_handle = app.handle().clone();
            let bundled_for_cb = bundled_version.clone();
            let tray_for_versions = tray.clone();
            let on_versions_changed: tee_rex_accelerator::server::VersionsChangedCallback =
                Arc::new(move || {
                    match build_versions_submenu(&app_handle, &bundled_for_cb) {
                        Ok(new_submenu) => {
                            // Rebuild the full menu with the updated versions submenu
                            let status_rebuild = status.clone();
                            let show_logs_rebuild =
                                MenuItemBuilder::with_id("show_logs", "Show Logs")
                                    .build(&app_handle)
                                    .unwrap();
                            let autostart_enabled =
                                app_handle.autolaunch().is_enabled().unwrap_or(false);
                            let autostart_rebuild =
                                CheckMenuItemBuilder::with_id("toggle_autostart", "Start on Login")
                                    .checked(autostart_enabled)
                                    .build(&app_handle)
                                    .unwrap();
                            let quit_rebuild = MenuItemBuilder::with_id("quit", "Quit")
                                .build(&app_handle)
                                .unwrap();
                            let new_menu = MenuBuilder::new(&app_handle)
                                .items(&[
                                    &status_rebuild,
                                    &new_submenu,
                                    &show_logs_rebuild,
                                    &autostart_rebuild,
                                    &quit_rebuild,
                                ])
                                .build()
                                .unwrap();
                            let _ = tray_for_versions.set_menu(Some(new_menu));
                            tracing::info!("Versions submenu updated");
                        }
                        Err(e) => {
                            tracing::warn!("Failed to rebuild versions submenu: {e}");
                        }
                    }
                });

            let state = AppState {
                on_status: Some(Arc::new(move |text: &str| {
                    tracing::info!(text, "on_status callback fired");
                    if let Err(e) = status_clone.set_text(text) {
                        tracing::error!("set_text failed: {e}");
                    }
                    if let Err(e) = tray_clone.set_tooltip(Some(text)) {
                        tracing::error!("set_tooltip failed: {e}");
                    }
                })),
                bundled_version: Some(bundled_version),
                on_versions_changed: Some(on_versions_changed),
            };

            // Spawn the HTTP server on the Tokio runtime
            tauri::async_runtime::spawn(async move {
                if let Err(e) = tee_rex_accelerator::server::start(state).await {
                    tracing::error!("Accelerator server error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TeeRex Accelerator");
}
