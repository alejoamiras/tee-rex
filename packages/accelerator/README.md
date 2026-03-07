# TeeRex Accelerator

Native proving accelerator for Aztec transactions. Bypasses browser WASM throttling by running the `bb` proving binary natively on your machine, exposed via a localhost HTTP server that the SDK auto-detects.

[![Accelerator](https://github.com/alejoamiras/tee-rex/actions/workflows/accelerator.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/accelerator.yml)

## Installation

Download the latest release from [GitHub Releases](https://github.com/alejoamiras/tee-rex/releases):

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux (x86_64) | `.deb`, `.AppImage` |

### macOS Gatekeeper

The app is currently unsigned. On first launch, macOS will block it. To allow it:

1. Open **System Settings → Privacy & Security**
2. Scroll to the "Security" section
3. Click **Open Anyway** next to the TeeRex Accelerator message

Or from the terminal:

```sh
xattr -cr /Applications/TeeRex\ Accelerator.app
```

## How It Works

The accelerator runs as a **menu bar / system tray app** with no window — just a tray icon with a status menu.

When running, it listens on `http://127.0.0.1:59833` for proving requests from the SDK. The flow:

```
Browser (SDK)  →  HTTP POST /prove  →  Accelerator  →  bb binary  →  proof
                  (localhost:59833)     (Tauri app)     (native)
```

The SDK auto-detects the accelerator on port 59833 when set to `ProvingMode.accelerated`. If the accelerator is unavailable or has a version mismatch, the SDK automatically falls back to WASM proving.

## Configuration

### Port

The default port is `59833`. Override it with the `TEE_REX_ACCELERATOR_PORT` environment variable (must match on both SDK and accelerator sides).

### bb Binary Resolution

The accelerator looks for the `bb` proving binary in this order:

1. **Sidecar** — bundled with the app (`binaries/bb`)
2. **`~/.bb/bb`** — user-installed via the Aztec CLI
3. **`PATH`** — system-wide installation

The `/health` endpoint reports which `bb` binary is in use.

## Auto-Start on Login

Enable automatic startup via the tray menu:

```
Status: Idle
Show Logs
Start on Login  ✓   ← toggle this checkbox
Quit
```

When enabled, the accelerator launches automatically when you log in to your computer. Uses platform-native mechanisms (LaunchAgent on macOS, autostart on Linux).

## Version Compatibility

The accelerator and SDK must use the same Aztec version. The accelerator embeds the Aztec version of its bundled `bb` binary and reports it via `/health`:

```json
{
  "status": "ok",
  "aztec_version": "0.87.4",
  "bb": "/Users/you/.bb/bb"
}
```

The SDK compares this with its own `@aztec/stdlib` dependency version. On mismatch, the SDK falls back to WASM proving and logs a warning. On `"unknown"` version, the SDK proceeds optimistically.

## Troubleshooting

### Logs

The accelerator writes daily-rotating logs. Open the log directory from the tray menu (**Show Logs**) or find them at:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/tee-rex-accelerator/logs/` |
| Linux | `~/.local/share/tee-rex-accelerator/logs/` |

### Port Conflicts

If port 59833 is already in use, the accelerator will fail to start. Check for conflicts:

```sh
lsof -i :59833
```

### bb Binary Not Found

If no `bb` binary is found, the `/health` endpoint returns `"bb": null` and `/prove` requests return a 500 error. Install the Aztec CLI to get the `bb` binary:

```sh
curl -s https://install.aztec.network | bash
aztec install
```

## Development

```sh
# Prerequisites: Rust toolchain, Tauri CLI
cargo install tauri-cli

# Copy bb binary for sidecar (reads version from @aztec/bb.js)
bun run --filter accelerator prebuild

# Run in development mode
cd packages/accelerator/src-tauri
cargo tauri dev

# Run tests
cargo test

# Build release
cargo tauri build
```
