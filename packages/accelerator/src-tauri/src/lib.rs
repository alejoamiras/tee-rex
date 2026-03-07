pub mod bb;
pub mod server;

use std::path::PathBuf;

/// Returns the log directory: `~/Library/Application Support/tee-rex-accelerator/logs/` (macOS).
pub fn log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tee-rex-accelerator")
        .join("logs")
}
