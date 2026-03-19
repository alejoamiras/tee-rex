# Local Native Accelerator — Decision Document

**Phase 31** · Date: 2026-03-03 · Status: **Planning**

---

## Problem Statement

Browser-based WASM proving for Aztec transactions is **throttled by the browser**. Browsers limit CPU and memory available to WASM workloads, making proof generation significantly slower than native execution. This creates a poor UX for any Aztec dApp using `EmbeddedWallet` with local proving — the most common production pattern.

**Measured impact**: Native `bb` binary execution is dramatically faster than browser WASM for the same proof. The bottleneck is CPU-bound (ClientIVC proof generation), and browsers throttle WASM threads and memory.

**Who's affected**: Every Aztec dApp that uses `EmbeddedWallet` with in-browser proving. This is expected to be the majority of ecosystem teams, since `EmbeddedWallet` provides the most features and customization without depending on external wallets.

---

## Solution: Local Native Accelerator

A lightweight native desktop application that runs the Barretenberg (`bb`) proving binary at full native CPU speed. The browser sends proving requests to this local application over `http://127.0.0.1:59833`, and the accelerator returns the proof.

### User Experience

```
1. User installs "TeeRex Accelerator" (tray icon appears)
2. Any Aztec dApp using TeeRexProver automatically detects it
3. Proving happens natively at full speed instead of throttled WASM
4. If accelerator not running → automatic fallback to WASM
```

### Developer Experience

```typescript
import { TeeRexProver } from "@alejoamiras/tee-rex";

// Accelerated mode (default when no apiUrl — auto-falls back to WASM)
const prover = new TeeRexProver();

// Or with explicit mode
const prover = new TeeRexProver({ provingMode: "accelerated" });

// Switch modes at runtime
prover.setProvingMode("accelerated");
prover.setProvingMode("local");
prover.setProvingMode("uee", { apiUrl: "https://testnet.tee-rex.dev/prover" });
```

Any dApp using `@alejoamiras/tee-rex` gets accelerator support with zero code changes if they're already on `ProvingMode.local` (which becomes `ProvingMode.accelerated` with WASM fallback).

---

## Architecture

```
Browser (https://your-dapp.com)
  └─ TeeRexProver.createChonkProof() [mode: "accelerated"]
     │
     ├─ Phase: "detect"
     │  └─ GET http://127.0.0.1:59833/health
     │     ├─ 200 OK → proceed with native proving
     │     └─ Connection refused → fallback to WASM (super.createChonkProof())
     │
     ├─ Phase: "serialize"
     │  └─ executionSteps → JSON (reuses existing serialization)
     │
     ├─ Phase: "transmit"
     │  └─ POST http://127.0.0.1:59833/prove
     │     Body: { executionSteps: [...] }
     │
     ├─ Phase: "proving"  (accelerator runs bb binary)
     │
     └─ Phase: "receive"
        └─ Response: { proof: Buffer (base64) }
        └─ ChonkProofWithPublicInputs.fromBuffer()

Native Accelerator (127.0.0.1:59833)
  ├─ GET  /health     → { status: "ok", version: "..." }
  ├─ POST /prove      → receives executionSteps, runs bb, returns proof
  └─ Tray icon        → idle / proving / error status
```

### Data Flow Comparison

| Aspect | WASM (current) | Remote TEE | Accelerator |
|--------|---------------|------------|-------------|
| Where proving runs | Browser (throttled WASM) | Remote server (native bb) | Local machine (native bb) |
| Network | None | Internet (HTTPS) | Loopback only (127.0.0.1) |
| Encryption | None needed | OpenPGP (curve25519 + AES-256-GCM) | None (see Security section) |
| Attestation | None | Nitro TEE attestation | None |
| Latency overhead | None | Network RTT + encrypt/decrypt | ~0 (localhost) |
| Proof speed | Slow (throttled) | Fast (native) | Fast (native) |
| Trust model | Trust your machine | Trust TEE attestation | Trust your machine |
| Requires | Nothing | Internet + server URL | Accelerator installed |

---

## Decisions Made

### 1. No Browser Extension Required

**Decision**: Use direct `http://127.0.0.1` HTTP from the browser. No extension.

**Rationale**: We studied the [demo-wallet](https://github.com/AztecProtocol/demo-wallet) architecture extensively. Demo-wallet uses an extension ↔ native app communication pattern (native messaging via stdio, Unix sockets, chunked message reassembly) because it needs wallet functionality (session management, ECDH encryption, capability-based authorization, account coordination).

Our use case is much simpler — we just need to send execution steps and get a proof back. Browsers explicitly allow `http://localhost` and `http://127.0.0.1` from HTTPS pages:
- Chrome treats localhost as a [secure context](https://www.chromium.org/Home/chromium-security/prefer-secure-origins-for-powerful-new-features/)
- Firefox treats localhost as secure
- No mixed-content restrictions for loopback

**What we skip**: Content scripts, background workers, native messaging manifests, `browser.runtime.connectNative()`, chunk reassembly, extension store publishing, per-browser compatibility.

**Rollback path**: If we discover browsers block this in some scenario, we can add an extension later. The SDK's `#acceleratedCreateChonkProof()` method would switch from `fetch()` to `window.postMessage()` — the proving flow stays the same.

### 2. Framework: Tauri 2.0 (not Electron, not bun compile)

**Decision**: Use [Tauri 2.0](https://v2.tauri.app/) for the native accelerator app.

**Comparison**:

| Aspect | Electron | Tauri 2.0 | bun build --compile |
|--------|----------|-----------|---------------------|
| Binary size | ~150MB+ | ~5-10MB | ~50-80MB |
| Memory idle | 200-300MB | 30-40MB | ~30MB |
| Startup | 1-2s | <0.5s | <0.5s |
| Tray icon | Mature | First-class (v2) | Requires `systray2` or similar (fragile) |
| Code signing | Electron Forge | Built-in (`tauri-action`) | Manual |
| Notarization | Electron Forge | Built-in | Manual |
| CI/CD | `electron-forge` | [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) | Custom |
| Auto-update | `electron-updater` | Built-in updater | Custom |
| Cross-platform | macOS, Linux, Windows | macOS, Linux, Windows | macOS, Linux, Windows |
| Backend language | JavaScript | **Rust** | JavaScript/TypeScript |
| Ecosystem maturity | Since 2013, massive | Since 2024 (v2 stable), growing | Experimental for desktop |
| Companies using | Slack, VS Code, Discord | ~90 incl. Cloudflare, ABBYY | Few |

**Why Tauri**:
- 5-10MB binary vs 150MB+ for Electron — huge for a background utility
- 30MB memory vs 200-300MB — important since it runs alongside browser
- First-class tray icon, code signing, notarization, auto-updater
- Official GitHub Action for CI builds
- Stable v2 since late 2024, growing 35% YoY

**Why not Electron**: Overkill for a tray app with no UI. Bundling Chromium for a background process that just listens on a socket is wasteful.

**Why not bun compile**: No reliable cross-platform tray icon support. No built-in code signing or notarization. Would need to build all that infrastructure manually. Good for headless CLIs, not desktop utilities.

**Risks with Tauri**:
- Rust learning curve (neither of us has Rust experience)
- Smaller ecosystem than Electron (might hit gaps in plugins)
- Younger project (fewer Stack Overflow answers, fewer battle-tested patterns)

**Mitigations**:
- Our Rust code is minimal: HTTP server + process spawn + tray management
- Tauri's core plugins cover everything we need (shell/sidecar for bb, tray icon)
- If Tauri becomes a blocker, we have clear rollback paths (see below)

**Rollback paths**:

1. **Tauri → Electron**: The HTTP server logic (receive JSON, spawn bb, return proof) is framework-agnostic. Rewrite the Rust wrapper in JS, use `electron-forge` for packaging. Estimated effort: 2-3 days.

2. **Tauri → bun compile**: Strip the tray icon, make it a CLI daemon (`tee-rex-accelerator start`). Use `bun build --compile` for single-binary distribution. Lose auto-update and tray, gain simplicity. Estimated effort: 1-2 days.

3. **Tauri → Go binary**: Write a simple Go binary with `systray` library. Native cross-compilation. Estimated effort: 3-4 days.

### 3. Port: 59833

**Decision**: Use port `59833` on `127.0.0.1`.

**Rationale**:
- Port 59833 is in the **dynamic/private range** (49152-65535) per [RFC 6335](https://www.rfc-editor.org/rfc/rfc6335.html)
- IANA **never assigns** ports in this range — zero risk of future conflict
- Mnemonic: "TEE" = 833 on phone T9 keypad, 59 prefix keeps it in the safe range
- Not used by any known application (checked against common dynamic ports: WireGuard 51820, Transmission 51413, mosh 60000)

**Configurable**: via `TEE_REX_ACCELERATOR_PORT` environment variable (both SDK and accelerator read it).

**Ports we avoided**:
- 1024-49151 (User Ports): IANA may assign these in the future
- 51413 (Transmission), 51820 (WireGuard), 55555 (common testing), 60000 (mosh)
- 17225 (originally considered, but in User Port range)

### 4. Binding: 127.0.0.1 Only (Never 0.0.0.0)

**Decision**: Bind exclusively to `127.0.0.1`, never `0.0.0.0`.

**Rationale**:
- `127.0.0.1` is loopback — traffic never leaves the machine, never touches a network interface
- `0.0.0.0` listens on ALL interfaces (Wi-Fi, Ethernet) — would expose the prover to the local network
- **macOS Sequoia**: Binding to `0.0.0.0` triggers the [Local Network permission prompt](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). Binding to `127.0.0.1` does NOT trigger it — loopback is exempt.
- **macOS Application Firewall**: May prompt for "incoming connections" even on localhost for unsigned apps. Solution: code-sign the Tauri binary (done automatically by `tauri-action` in CI).
- **Windows/Linux**: No firewall prompts for loopback binding.

### 5. Encryption: Not in v1, Architecturally Supported

**Decision**: Ship v1 without encryption on the localhost channel. Design the architecture so encryption can be added cleanly in v2.

**Threat model analysis**:

The proving payload (`PrivateExecutionStep[]`) contains:
- `witness` — private circuit inputs (field elements) ← **sensitive**
- `bytecode` — compiled circuit code
- `vk` — verification key
- `functionName`, `timings` — metadata

An attacker who can intercept `127.0.0.1` loopback traffic must already have **root access** to the machine. At that point, they can also:
- Read browser process memory (where the witness lives anyway)
- Read the PXE database
- Intercept keyboard input for private keys
- Read any file on disk

**Conclusion**: Encrypting localhost traffic does not change the trust boundary. You already trust your machine for WASM proving (the witness is in browser memory). The accelerator has the same trust model.

**If encryption is needed later**:

Option A — **Shared secret authentication** (simplest):
1. Accelerator generates a random token on first launch → `~/.tee-rex/accelerator.token`
2. SDK reads the token, sends as `Authorization: Bearer <token>` header
3. Accelerator validates before processing
4. Estimated effort: ~20 lines of code

Option B — **Full encryption** (reuses existing code):
1. Accelerator generates an OpenPGP key pair on first launch → `~/.tee-rex/accelerator.pub`
2. SDK reads public key from `GET /key` or from disk
3. SDK encrypts payload with same `encrypt()` function used for remote mode
4. Accelerator decrypts with private key
5. Estimated effort: ~50 lines of code (reuses `encrypt.ts` and `encryption-service.ts`)

### 7. HTTPS Port: 59834 (Safari Mixed Content)

**Decision**: Add optional HTTPS on port `59834` via auto-provisioned local certificates, opt-in via tray menu toggle.

**Problem**: Safari blocks mixed content — an HTTPS page cannot `fetch()` from `http://127.0.0.1`. Chrome and Firefox exempt localhost per the [Secure Contexts spec](https://www.chromium.org/Home/chromium-security/prefer-secure-origins-for-powerful-new-features/), but Safari does not. This means accelerated proving silently falls back to WASM for all Safari users.

**Alternatives rejected**:
- **Browser extension**: Overkill for just bypassing mixed-content (Decision #1 already rejected this)
- **Service Worker proxy**: Cannot intercept requests to different origins (`127.0.0.1`)
- **Custom URL scheme**: Not supported by `fetch()` API
- **WebSocket upgrade**: Complex, doesn't solve the initial HTTPS handshake

**Solution**: Same approach as `mkcert` and TypingMind's MCP connector:
1. Generate a local CA + leaf certificate (ECDSA P-256)
2. Install CA in macOS Keychain (one password prompt, ever)
3. Serve HTTPS on port 59834 alongside HTTP on 59833
4. SDK probes both ports with `Promise.any` — HTTP wins for Chrome/Firefox, HTTPS wins for Safari

**Safety rules**:
- Config only saved AFTER trust verified (never write `safari_support: true` before `security add-trusted-cert` exits 0)
- HTTPS failure never crashes HTTP (independent server tasks)
- Name Constraints on CA limit it to `127.0.0.1`/`::1`/`localhost` only
- macOS only (hidden on Linux via `#[cfg]`)
- CA removed from Keychain by user → detected on next launch, HTTPS skipped gracefully

### 6. Repository: Monorepo (packages/accelerator)

**Decision**: The accelerator lives in this monorepo as `packages/accelerator`.

**Rationale**:
- **Version coupling**: Accelerator must serialize/deserialize `PrivateExecutionStep` exactly like the SDK. Monorepo ensures they evolve together with Aztec version bumps.
- **Shared code**: Serialization format, Zod schemas, types — all shared between SDK and accelerator.
- **CI already handles multiple packages**: Per-package workflows with path filters. Adding one more is incremental.
- **Atomic releases**: When Aztec nightlies bump, SDK + accelerator update together.

**Workspace structure**:
```
tee-rex/
├── packages/
│   ├── sdk/           → @alejoamiras/tee-rex (npm) — adds ProvingMode.accelerated
│   ├── server/        → Express TEE server (unchanged)
│   ├── app/           → Demo frontend (unchanged)
│   └── accelerator/   → Tauri tray app (NEW)
│       ├── src-tauri/  → Rust: tray icon, HTTP server, bb process management
│       ├── src/        → Minimal web UI (settings page, optional)
│       └── package.json
```

---

## What We Studied (Reference Material)

### Demo Wallet Architecture (`/Users/alejoamiras/Projects/demo-wallet`)

Extensively studied for the extension ↔ native app communication pattern:

- **Extension**: WXT-based, content script (pure relay) + background worker (native messaging, ECDH encryption, session management)
- **Native Host**: Stateless relay binary compiled with `@yao-pkg/pkg`. Bridges stdio (length-prefixed JSON) ↔ Unix socket (newline-delimited JSON). No encryption, no state — pure message pass-through.
- **Electron App**: Full wallet with PXE, LMDB database, account management, authorization flows. Uses `BackendType.NativeUnixSocket` + `bb` binary for native proving.
- **Communication chain**: Web page → Content script → Background worker → Native messaging (stdio) → Native host binary → Unix socket → Electron main → MessagePort → Wallet worker → PXE → bb binary → (7 hops back)
- **Security**: ECDH + AES-GCM between dApp and extension, native messaging manifest for extension ID verification, capability-based authorization per operation.
- **Chunking**: Messages >900KB are automatically chunked (Chrome native messaging limit is 1MB).
- **Native messaging manifest**: JSON file at well-known OS paths declaring the native host binary path and allowed extension origins.

**Conclusion**: This architecture is over-engineered for our use case. We don't need wallets, accounts, authorization, or ECDH sessions. We just need to send bytes and get bytes back. localhost HTTP achieves this with zero infrastructure.

### TeeRex SDK Proving Flow (`packages/sdk/src/lib/tee-rex-prover.ts`)

Current architecture that we're extending:

- `TeeRexProver` extends `BBLazyPrivateKernelProver`, overrides `createChonkProof()`
- Two modes: `local` (delegates to parent WASM prover) and `remote` (HTTP to TEE server)
- Remote flow: serialize → fetch attestation → encrypt (OpenPGP) → POST /prove → deserialize proof
- Phase callback system: 6 phases (`serialize`, `fetch-attestation`, `encrypt`, `transmit`, `proving`, `receive`)
- Uses `ky` for HTTP with 5-min timeout and 2 retries
- Response validated with Zod
- `UnreachableCaseError` for exhaustive switch on ProvingMode

**Adding accelerated mode**: New case in the switch, new `#acceleratedCreateChonkProof()` method. Reuses serialization, skips attestation and encryption, uses `fetch()` to localhost instead of `ky` to remote server.

---

## Open Questions

1. **ProvingMode naming**: Should we rename `local` → `wasm` for clarity? Or keep `local` as-is and add `accelerated` as the new mode? Renaming is a breaking change.
2. **Auto-detection default**: Should `ProvingMode.accelerated` auto-fallback to WASM? Or should there be a separate `ProvingMode.auto` that tries accelerated → WASM?
3. **bb binary distribution**: Should the accelerator bundle the `bb` binary, or expect the user to have it installed? Bundling increases binary size but simplifies setup.
4. **Aztec version compatibility**: The `bb` binary version must match the Aztec version. How do we ensure the accelerator has the right `bb` for the dApp's Aztec version?

---

## References

- [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/)
- [Tauri vs Electron 2025](https://www.raftlabs.com/blog/tauri-vs-electron-pros-cons/)
- [Tauri System Tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)
- [Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Shipping Production macOS App with Tauri 2.0](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3)
- [Apple TN3179: Understanding Local Network Privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [macOS Application Firewall](https://support.apple.com/en-us/HT201642)
- [RFC 6335: IANA Port Number Registry](https://www.rfc-editor.org/rfc/rfc6335.html)
- [Made with Tauri](https://madewithtauri.com/)
- [Demo Wallet (Aztec)](https://github.com/AztecProtocol/demo-wallet) — studied for extension ↔ native communication patterns
