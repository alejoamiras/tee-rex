//! Headless accelerator server — no Tauri, no GUI.
//!
//! Runs the same Axum HTTP server as the Tauri app but without any display
//! context. Used in CI for e2e testing against the native `bb` binary.

use tee_rex_accelerator::server::{start, AppState};
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(fmt::layer().with_writer(std::io::stdout))
        .init();

    tracing::info!("Starting headless accelerator server");

    let state = AppState::default();

    if let Err(e) = start(state).await {
        tracing::error!("Accelerator server error: {e}");
        std::process::exit(1);
    }
}
