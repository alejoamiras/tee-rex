# Local Native Accelerator — Implementation Plan

**Phase 31** · Companion to [accelerator-decision.md](./accelerator-decision.md)

---

## Guiding Principles

1. **Each step is independently verifiable** — if something breaks, we know exactly which step caused it
2. **SDK first, accelerator second** — the SDK changes can ship and be tested (with mocks) before the Tauri app exists
3. **Prove it works manually before automating** — get bb running from Tauri before building CI pipelines
4. **One new concept per step** — don't learn Rust + Tauri + bb + tray icons all at once

---

## Step 0: Preparation

### 0A. Branch and workspace setup

- Create feature branch `feat/accelerator` from `main`
- Add `packages/accelerator` to `bun-workspace` in root `package.json`
- Verify `bun install` still works with the new workspace entry (even if the directory is empty or has a minimal `package.json`)

**Validation**: `bun install` succeeds, existing `bun run test` still passes.

### 0B. Install Rust toolchain

- Install Rust via `rustup` (if not already present)
- Install Tauri CLI: `cargo install tauri-cli` (or `bun add -D @tauri-apps/cli`)
- Verify: `cargo --version`, `rustc --version`, `cargo tauri --version`

**Validation**: All three commands return version numbers.

---

## Step 1: SDK — Add `ProvingMode.accelerated` (No Tauri Yet)

This step is pure TypeScript, no Rust, no Tauri. We extend `TeeRexProver` to support a third mode that talks to `http://127.0.0.1:59833`.

### 1A. Extend ProvingMode enum

In `packages/sdk/src/lib/tee-rex-prover.ts`:

```typescript
export const ProvingMode = {
  local: "local",           // WASM in-process (renamed conceptually, kept for compat)
  remote: "remote",         // TEE server via HTTPS
  accelerated: "accelerated", // Local native bb via localhost HTTP
} as const;
```

**Validation**: `bun run test` passes (no behavior change yet, just a new enum value).

### 1B. Add accelerator configuration

Add to `TeeRexProver`:

```typescript
#acceleratorPort: number = 59833;
#acceleratorHost: string = "127.0.0.1";

setAcceleratorConfig(config: { port?: number; host?: string }): void {
  if (config.port) this.#acceleratorPort = config.port;
  if (config.host) this.#acceleratorHost = config.host;
}

get #acceleratorBaseUrl(): string {
  return `http://${this.#acceleratorHost}:${this.#acceleratorPort}`;
}
```

Also read from environment: `process.env.TEE_REX_ACCELERATOR_PORT`.

**Validation**: `bun run test` passes. New config method exists on the class.

### 1C. Implement `#acceleratedCreateChonkProof`

New private method in `TeeRexProver`:

```typescript
async #acceleratedCreateChonkProof(
  executionSteps: PrivateExecutionStep[],
): Promise<ChonkProofWithPublicInputs> {
  // 1. Check if accelerator is running
  this.#onPhase?.("detect");
  const isAvailable = await this.#checkAcceleratorHealth();

  if (!isAvailable) {
    logger.info("Accelerator not available, falling back to WASM");
    this.#onPhase?.("proving");
    const proof = await super.createChonkProof(executionSteps);
    this.#onPhase?.("receive");
    return proof;
  }

  // 2. Serialize (reuse existing serialization)
  this.#onPhase?.("serialize");
  const serialized = executionSteps.map((step) => ({
    functionName: step.functionName,
    witness: Array.from(step.witness.entries()),
    bytecode: Base64.fromBytes(step.bytecode),
    vk: Base64.fromBytes(step.vk),
    timings: step.timings,
  }));

  // 3. POST to accelerator (no encryption — localhost)
  this.#onPhase?.("transmit");
  const response = await ky
    .post(joinURL(this.#acceleratorBaseUrl, "/prove"), {
      json: { executionSteps: serialized },
      timeout: ms("10m"),  // native proving can still take a while
      retry: 0,            // no retry — if localhost fails, it's dead
    })
    .json<{ proof: string }>();

  // 4. Deserialize proof
  this.#onPhase?.("receive");
  const proofSchema = z.object({ proof: schemas.bufferSchema });
  const data = proofSchema.parse(response);
  return ChonkProofWithPublicInputs.fromBuffer(data.proof);
}
```

### 1D. Wire into createChonkProof switch

Add the `"accelerated"` case to the existing switch statement:

```typescript
case "accelerated": {
  return this.#acceleratedCreateChonkProof(executionSteps);
}
```

### 1E. Add "detect" to ProverPhase

```typescript
export type ProverPhase =
  | "detect"            // NEW: checking accelerator availability
  | "serialize"
  | "fetch-attestation"
  | "encrypt"
  | "transmit"
  | "proving"
  | "receive";
```

**Validation**: `bun run test` passes. TypeScript compiles. Lint passes.

### 1F. Unit tests for accelerated mode

In `packages/sdk/src/lib/tee-rex-prover.test.ts`, add new `describe("Accelerated")` block:

**Tests to add**:

1. **Routes to accelerator when in accelerated mode** — Mock `fetch` to return 200 from health check and a fake proof from `/prove`. Verify the correct URLs are called.

2. **Falls back to WASM when accelerator unavailable** — Mock `fetch` to throw `ECONNREFUSED` on health check. Spy on `super.createChonkProof`. Verify WASM fallback is called.

3. **Sends correct serialization format** — Mock `fetch`, capture the POST body, verify it matches the expected JSON structure (witness as array of entries, bytecode/vk as base64).

4. **Deserializes proof correctly** — Mock `/prove` to return a valid base64 proof buffer. Verify `ChonkProofWithPublicInputs.fromBuffer()` is called.

5. **Respects custom port configuration** — Set `setAcceleratorConfig({ port: 12345 })`. Mock fetch. Verify requests go to port 12345.

6. **Phase callbacks fire in order** — Attach `setOnPhase()` callback. Mock the full flow. Verify phases: `detect → serialize → transmit → receive`.

7. **Phase callbacks for WASM fallback** — Attach callback. Mock health check failure. Verify phases: `detect → proving → receive`.

**Validation**: `bun test packages/sdk/src/lib/tee-rex-prover.test.ts` — all tests pass.

### 1G. Export and documentation updates

- Ensure `ProvingMode.accelerated` is exported from `index.ts`
- Update SDK README to add accelerated mode to the Mode Switching section
- Update the API Reference section with `setAcceleratorConfig`

**Validation**: `bun run test` (full suite), `bun run lint`.

---

## Step 2: Tauri — Scaffold and Verify

### 2A. Create Tauri project

```bash
cd packages/accelerator
cargo tauri init
# Or: bun create tauri-app
```

Configure:
- App name: `tee-rex-accelerator`
- Bundle identifier: `dev.tee-rex.accelerator`
- Window: hidden (tray-only app)
- Frontend: minimal (single HTML page with status, or none)

**Validation**: `cargo tauri dev` launches without errors (even if it shows an empty window).

### 2B. Add system tray

Configure tray icon in `src-tauri/`:
- Add tray icon asset (16x16, 32x32 PNG)
- Configure `tauri.conf.json` for tray
- Implement basic tray menu: "Status: Idle", separator, "Quit"
- On "Quit": exit the process

**Validation**: `cargo tauri dev` shows a tray icon. Clicking "Quit" exits.

### 2C. Remove default window (tray-only mode)

- Set `"visible": false` for the default window in `tauri.conf.json`
- Or remove the window entirely if Tauri allows tray-only apps
- The app should launch with only a tray icon, no window

**Validation**: `cargo tauri dev` shows only a tray icon. No window appears.

---

## Step 3: Tauri — Execute bb Binary

This is the critical proof-of-concept: can Tauri's Rust backend spawn the `bb` binary?

### 3A. Research bb binary invocation

- Study how `BBLazyPrivateKernelProver` invokes `bb` (from `@aztec/bb-prover`)
- Study how the tee-rex server's `ProverService` resolves the `bb` binary path
- Understand the command-line interface: what args does `bb` take for `createChonkProof`?
- Document the expected stdin/stdout/file-based protocol

**Validation**: Written understanding of how to invoke `bb` from the command line. Manual test: run `bb` with test inputs from terminal.

### 3B. Spawn bb from Rust

In `src-tauri/src/main.rs` (or a dedicated module):
- Use `std::process::Command` to spawn the `bb` binary
- Pass the required arguments
- Capture stdout/stderr
- Handle exit codes

Start simple: just verify we can spawn `bb --version` (or equivalent) and get output.

**Validation**: Tauri app logs the bb binary version on startup.

### 3C. bb binary resolution

Implement bb binary discovery:
1. Check `BB_BINARY_PATH` environment variable
2. Check well-known paths (e.g., `~/.bb/bb`, bundled in app resources)
3. Check `PATH`
4. If not found, show tray tooltip: "bb binary not found"

**Validation**: Tray icon shows "ready" when bb is found, "not found" when it isn't.

---

## Step 4: Tauri — HTTP Server on Localhost

### 4A. Add HTTP server to Rust backend

Use a lightweight Rust HTTP framework (e.g., `actix-web`, `axum`, or `tiny_http`) embedded in the Tauri app:

```rust
// Bind to 127.0.0.1:59833 ONLY
let listener = TcpListener::bind("127.0.0.1:59833")?;
```

Implement endpoints:
- `GET /health` → `{ "status": "ok", "version": "0.1.0" }`
- (Other endpoints in later steps)

**Validation**:
```bash
cargo tauri dev &
curl http://127.0.0.1:59833/health
# → {"status":"ok","version":"0.1.0"}
```

### 4B. Implement `POST /prove` endpoint

Receive JSON body with `executionSteps`, deserialize, pass to bb binary, return proof.

This is the complex step. Sub-tasks:
1. Define the JSON schema for incoming requests (match SDK's serialization format)
2. Deserialize witness (array of entries → whatever bb expects)
3. Write execution steps to temp files (if bb uses file-based I/O)
4. Spawn bb with the right arguments
5. Read proof output
6. Return as JSON response `{ proof: "<base64>" }`

**Validation**: `curl -X POST http://127.0.0.1:59833/prove -H 'Content-Type: application/json' -d @test-payload.json` returns a proof (or a meaningful error).

### 4C. Tray status updates

- Tray icon changes during proving (idle → proving → done)
- Tray tooltip shows: "Proving..." with elapsed time
- If proving fails, tray shows error briefly, then returns to idle

**Validation**: Start a prove request, observe tray icon changing state.

### 4D. CORS headers

The browser needs CORS headers to make cross-origin requests to localhost:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Content-Type
```

**Validation**: Open browser console, `fetch("http://127.0.0.1:59833/health")` succeeds without CORS error.

---

## Step 5: End-to-End Integration (SDK ↔ Accelerator)

### 5A. Manual integration test

1. Start the Tauri accelerator (`cargo tauri dev`)
2. In a separate terminal, run a Node.js script that:
   - Creates a `TeeRexProver` in accelerated mode
   - Calls `createChonkProof` with real execution steps
   - Verifies the proof is valid

**Validation**: Proof returned successfully. Compare with WASM-generated proof (should be identical).

### 5B. Fallback test

1. Stop the accelerator
2. Run the same script
3. Verify it falls back to WASM without errors

**Validation**: Proof returned via WASM fallback. Log message confirms fallback.

### 5C. SDK e2e test structure

Add to `packages/sdk/e2e/proving.test.ts`:

```typescript
describe.skipIf(!process.env.ACCELERATOR_URL)("Accelerated", () => {
  test("should deploy account with accelerated proving", async () => {
    prover.setProvingMode(ProvingMode.accelerated);
    if (process.env.ACCELERATOR_URL) {
      const url = new URL(process.env.ACCELERATOR_URL);
      prover.setAcceleratorConfig({
        host: url.hostname,
        port: Number.parseInt(url.port, 10),
      });
    }
    const deployed = await deploySchnorrAccount(wallet, feePaymentMethod, "accelerated");
    expect(deployed).toBeDefined();
  }, 600000);
});
```

**Validation**: Test passes when accelerator is running. Test skips when `ACCELERATOR_URL` not set.

---

## Step 6: Cross-Platform Builds

### 6A. macOS build (local machine first)

```bash
cd packages/accelerator
cargo tauri build
```

Verify:
- `.dmg` or `.app` is generated
- App launches from the built artifact
- Tray icon works
- `/health` endpoint responds

**Validation**: Built macOS app works end-to-end.

### 6B. Code signing and notarization (macOS)

Set up Apple Developer certificate:
- Export `.p12` cert
- Configure `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`
- Configure `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for notarization

**Validation**: Built app is signed. `codesign -dv --verbose=4 <app>` shows valid signature. `spctl -a -v <app>` passes Gatekeeper.

### 6C. GitHub Actions CI workflow

Create `.github/workflows/accelerator.yml`:

```yaml
name: Accelerator
on:
  pull_request:
    paths:
      - packages/accelerator/**
      - .github/workflows/accelerator.yml

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: tauri-apps/tauri-action@v0
        # ...
```

**Validation**: CI builds succeed on all platforms. Artifacts downloadable from GitHub Actions.

### 6D. Windows and Linux smoke test

Download CI artifacts for Windows and Linux. Test on each:
- App launches
- Tray icon appears
- `/health` endpoint responds
- `/prove` endpoint works (with test payload)

**Validation**: Works on all three platforms.

---

## Step 7: bb Binary Distribution Strategy

### 7A. Research bb binary availability

- How does Aztec distribute the `bb` binary?
- Is it available as a standalone download?
- Is it bundled in `@aztec/bb-prover`? If so, how is it extracted?
- What platforms are supported?

### 7B. Decide on distribution approach

Options:
1. **Bundle bb in the accelerator** — larger binary, simpler UX
2. **Download bb on first launch** — smaller initial download, needs network
3. **Expect bb pre-installed** — smallest app, but requires user setup

### 7C. Implement chosen approach

Implement the bb binary resolution/download/bundling based on the decision.

**Validation**: Fresh install of accelerator on a clean machine → bb is available → `/prove` works.

---

## Step 8: Polish and Production Readiness

### 8A. Auto-start on login (optional)

- macOS: Login Item
- Windows: Registry / Startup folder
- Linux: systemd user service or XDG autostart

### 8B. Auto-update

Configure Tauri's built-in updater:
- GitHub Releases as update source
- Check for updates on launch (background check)
- Tray menu: "Check for Updates"

### 8C. Error handling and logging

- Log to `~/.tee-rex/accelerator.log`
- Tray menu: "View Logs"
- Crash recovery: if bb segfaults, return 500 to SDK, log the error, reset state

### 8D. App README and docs

- `packages/accelerator/README.md` — installation, usage, configuration
- Update root `README.md` architecture section
- Update `docs/architecture.md` with accelerator flow diagram
- Update SDK README with accelerator section

---

## Step 9: CI Pipeline Integration

### 9A. Accelerator workflow

- Build on PR (when `packages/accelerator/**` changes)
- Gate job pattern (like other packages)
- Cache Rust compilation (`~/.cargo`, `target/`)
- Cache bb binary download (if applicable)

### 9B. Release workflow

- Trigger on tag push or manual dispatch
- Build for all platforms (macOS ARM64, macOS x64, Linux x64, Windows x64)
- Code sign (macOS + Windows)
- Notarize (macOS)
- Create GitHub Release with artifacts
- Auto-updater JSON

### 9C. Integration e2e workflow (future)

- Start accelerator in CI
- Run SDK e2e tests with `ACCELERATOR_URL=http://127.0.0.1:59833`
- Validate the full flow: SDK → Accelerator → bb → proof

---

## Dependency Graph

```
Step 0 (setup)
  ↓
Step 1 (SDK changes) ←── can ship independently
  ↓
Step 2 (Tauri scaffold)
  ↓
Step 3 (bb from Tauri) ←── critical proof-of-concept
  ↓
Step 4 (HTTP server)
  ↓
Step 5 (integration) ←── first full end-to-end
  ↓
Step 6 (cross-platform)
  ↓
Step 7 (bb distribution)
  ↓
Step 8 (polish)
  ↓
Step 9 (CI pipeline)
```

**Key milestone**: After Step 5, we have a working accelerator. Steps 6-9 are production hardening.

**Early exit point**: If Tauri becomes a blocker at Step 2 or 3, we can pivot to Electron or bun compile. The SDK changes from Step 1 are framework-agnostic — they work regardless of what the accelerator is built with.

---

## Estimated Effort

| Step | Description | Estimate |
|------|-------------|----------|
| 0 | Preparation | Half a day |
| 1 | SDK changes + tests | 1-2 days |
| 2 | Tauri scaffold + tray | 1 day |
| 3 | bb binary execution | 1-2 days (research-heavy) |
| 4 | HTTP server | 1 day |
| 5 | Integration testing | 1 day |
| 6 | Cross-platform builds | 1-2 days |
| 7 | bb distribution | 1 day |
| 8 | Polish | 1-2 days |
| 9 | CI pipeline | 1-2 days |
| **Total** | | **~10-15 days** |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rust learning curve blocks progress | Medium | High | SDK (Step 1) ships independently. Tauri rollback paths documented. |
| bb binary can't be spawned from Tauri | Low | High | Test this in Step 3 before investing in HTTP server. Rust's `Command` is well-documented. |
| Browser blocks localhost HTTP | Very Low | High | All major browsers exempt localhost. If blocked, add extension layer. |
| macOS firewall prompts annoy users | Low | Medium | Code sign + notarize. Bind to 127.0.0.1 only. |
| bb binary distribution is complex | Medium | Medium | Research in Step 7. Multiple fallback strategies. |
| Proving payload too large for HTTP | Low | Low | Localhost has no size limits. Even 100MB+ payloads work over loopback. |
| Port 59833 conflicts on user's machine | Very Low | Low | Configurable via env var. Detection with clear error message. |
