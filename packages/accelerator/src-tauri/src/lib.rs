pub mod bb;
pub mod crash_recovery;
pub mod server;
pub mod versions;

use std::path::PathBuf;

/// Returns the log directory.
///
/// - macOS: `~/Library/Application Support/tee-rex-accelerator/logs/`
/// - Linux: `~/.local/share/tee-rex-accelerator/logs/`
pub fn log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tee-rex-accelerator")
        .join("logs")
}
