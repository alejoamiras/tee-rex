# Phase 4: Testing & Demo Frontend

## Overview

Three goals:
1. **Unit tests** for SDK and server — fast, isolated, mockable
2. **E2E tests** — validate the full proving flow end-to-end
3. **Demo frontend** — toggle between local/remote proving to showcase speed difference

---

## Part A: Unit Tests

### Current coverage

| Component | Tests | Coverage |
|---|---|---|
| `lazyValue()` | 0 | 0% |
| `encrypt()` / `unarmorToUint8Array()` | 0 | 0% |
| `EncryptionService` (key gen, decrypt, caching) | 0 | 0% |
| `ProverService` (lazy init, delegation) | 0 | 0% |
| `POST /prove` endpoint | 0 | 0% |
| `GET /encryption-public-key` endpoint | 0 | 0% |
| `TeeRexProver` constructor + mode switching | 1 | ~5% |
| `TeeRexProver.createChonkProof()` (local/remote routing) | 0 | 0% |

### A1: Server unit tests

#### A1.1: `packages/server/src/utils.test.ts` — `lazyValue()`

Smallest, zero-dependency unit. Good first test.

Tests:
- Returns the value from the factory function
- Calls factory only once (caching)
- Returns the same reference on subsequent calls
- Works with async factory functions
- Propagates errors from factory

Validation: `bun run --cwd packages/server test`

#### A1.2: `packages/server/src/EncryptionService.test.ts`

Tests:
- `getEncryptionPublicKey()` returns a valid armored PGP public key
- `getEncryptionPublicKey()` returns the same key on repeated calls (caching)
- `decrypt()` decrypts data that was encrypted with the corresponding public key (roundtrip)
- `decrypt()` throws on corrupted input
- `decrypt()` throws when encrypted with a different key

Dependencies: uses real `openpgp` (no mocks — it's fast enough and we want real crypto guarantees)

Requires: import `encrypt()` from SDK or duplicate the encrypt logic for test helpers. Best approach: create a shared test helper or import from SDK workspace.

Validation: `bun run --cwd packages/server test`

#### A1.3: `packages/server/src/index.test.ts` — Express endpoints

Tests using Bun's built-in `fetch` against the Express app (export the `app` from `index.ts` without starting the listener, or use a test setup that starts on a random port):

Refactor needed: extract `createApp()` function from `index.ts` so tests can import the app without starting the server.

Tests for `GET /encryption-public-key`:
- Returns 200 with `{ publicKey: string }`
- Public key is valid armored PGP format

Tests for `POST /prove`:
- Returns 200 with `{ proof: string }` given valid encrypted payload (requires mocking `ProverService`)
- Returns error on invalid/unencryptable body
- Returns error when body is not base64
- Handles prover errors gracefully

Mocking strategy:
- Mock `ProverService.createChonkProof()` to return a fake proof (avoids WASM/Aztec deps)
- Use real `EncryptionService` for encrypt/decrypt (fast, deterministic)

Validation: `bun run --cwd packages/server test`

#### A1.4: Update server `package.json`

Add test scripts:
```json
"scripts": {
  "test": "bun test",
  "test:unit": "bun test"
}
```

Add bunfig.toml with reasonable timeout (30s, not 10min like SDK).

### A2: SDK unit tests

#### A2.1: `packages/sdk/src/encrypt.test.ts`

Tests:
- `encrypt()` produces non-empty output
- `encrypt()` output differs from input (actually encrypted)
- Roundtrip: encrypt with public key, decrypt with private key (using openpgp directly in test)
- Throws on invalid public key string
- Handles empty data input

Validation: `bun run --cwd packages/sdk test:unit`

#### A2.2: Expand `packages/sdk/src/TeeRexProver.test.ts`

Current test: only checks instantiation. Expand to:

Tests:
- Default proving mode is `remote`
- `setProvingMode()` actually changes the routing behavior
- `createChonkProof()` in local mode calls `super.createChonkProof()` (mock via prototype spy)
- `createChonkProof()` in remote mode makes HTTP calls to the server (mock `ky` or use `fetch` mock)
- Remote mode: serializes execution steps correctly
- Remote mode: encrypts data before sending
- Remote mode: deserializes proof response correctly
- Remote mode: handles server errors (500, network timeout)
- Remote mode: handles invalid response format

Mocking strategy:
- Mock `ky` HTTP client (or `globalThis.fetch`) to intercept `/prove` and `/encryption-public-key` calls
- Provide fake encryption public key and fake proof responses
- Mock the parent class `createChonkProof()` for local mode tests

Validation: `bun run --cwd packages/sdk test:unit`

### A3: Root test script update

Update root `package.json` to run both SDK and server unit tests:
```json
"test:unit": "bun run --cwd packages/sdk test:unit && bun run --cwd packages/server test:unit"
```

---

## Part B: E2E Tests

### Current state

The integration tests in `packages/integration/` already cover the core E2E flow:
- Start services → connect → deploy account with remote proving

### B1: Restructure integration tests

Rename/reorganize for clarity:
- `connectivity.test.ts` → keep as-is (pre-flight checks)
- `proving.test.ts` → split into:
  - `remote-proving.test.ts` — current flow (deploy account via remote proving)
  - `local-proving.test.ts` — same flow but with `ProvingMode.local` to validate fallback

### B2: Add local proving E2E test

Same flow as remote proving but with `prover.setProvingMode(ProvingMode.local)`. This validates:
- Local fallback works end-to-end
- We can compare timing between local and remote in CI output

### B3: Add mode-switching E2E test

Start in remote mode, prove one operation, switch to local, prove another. Validates that mode switching works mid-session.

Validation: `bun run test:integration` (requires Aztec sandbox)

---

## Part C: Demo Frontend

### Goal

A minimal web page that:
1. Connects to an Aztec PXE
2. Shows a toggle: **Local Proving** / **Remote Proving (TEE)**
3. Triggers a transaction (e.g., deploy a test account)
4. Displays a timer showing proof generation time
5. Shows results side-by-side so the user sees the speed difference

### C1: Create `packages/demo` workspace

```
packages/demo/
├── package.json
├── tsconfig.json
├── index.html
├── src/
│   ├── main.ts          # Entry point, app setup
│   ├── proving.ts        # TeeRexProver setup, mode switching, timing
│   └── style.css         # Minimal styling
└── bunfig.toml
```

Tech stack:
- **Vanilla TypeScript** — no framework, keep it dead simple
- **Vite** — for dev server and bundling (works great with Bun)
- **@nemi-fi/tee-rex** — workspace dependency for the prover

### C2: UI design

Single page, minimal, clean:

```
┌─────────────────────────────────────────┐
│           🦖 TEE-Rex Demo               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Aztec PXE: http://localhost:.. │    │
│  │  TEE-Rex:   http://localhost:.. │    │
│  │  Status: ● Connected            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Proving Mode:                          │
│  [ Local ] [==Remote (TEE)==]           │
│                                         │
│  [ ▶ Deploy Test Account ]              │
│                                         │
│  ┌─────────────┬─────────────┐          │
│  │ Local       │ Remote      │          │
│  │ ⏱ 45.2s    │ ⏱ 8.3s     │          │
│  │ ✅ Success  │ ✅ Success  │          │
│  └─────────────┴─────────────┘          │
│                                         │
│  History:                               │
│  1. Remote: 8.3s ✅                     │
│  2. Local: 45.2s ✅                     │
└─────────────────────────────────────────┘
```

### C3: Implementation steps

1. Scaffold Vite project with TypeScript
2. Set up PXE client connection
3. Create TeeRexProver instance with mode control
4. Build the toggle UI (simple HTML + event listeners)
5. Implement the "deploy" action with timing
6. Display results with history
7. Add error states and loading indicators

### C4: Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Root addition:
```json
"demo": "bun run --cwd packages/demo dev"
```

Validation: `bun run demo` opens browser, toggle works, timing displayed

---

## Execution Order

| Step | Depends on | Description |
|---|---|---|
| A1.1 | — | `lazyValue()` tests |
| A1.2 | — | `EncryptionService` tests |
| A1.3 | A1.2 | Express endpoint tests (needs refactor to export app) |
| A1.4 | A1.1 | Server package.json + bunfig |
| A2.1 | — | `encrypt()` tests |
| A2.2 | A2.1 | Expanded `TeeRexProver` tests |
| A3 | A1.4, A2.2 | Root test script update |
| B1 | — | Restructure integration tests |
| B2 | B1 | Local proving E2E |
| B3 | B2 | Mode-switching E2E |
| C1 | — | Demo workspace scaffold |
| C2 | C1 | UI implementation |
| C3 | C2, A3 | Integration with real prover |
| C4 | C3 | Polish and root scripts |

Parts A, B, and C are largely independent and can be worked on in parallel once A3 (root scripts) is done.

---

## Server refactor note

To test Express endpoints properly, `packages/server/src/index.ts` needs a small refactor:

**Current:** creates app and starts listening in the same file.
**Target:** export a `createApp()` factory that returns the configured Express app. The `listen()` call only runs when the file is executed directly (not imported by tests).

```ts
// index.ts
export function createApp() {
  const app = express();
  // ... middleware, routes ...
  return app;
}

// Only start server when run directly
if (import.meta.main) {
  const app = createApp();
  app.listen(PORT, () => { ... });
}
```

This is a minimal, non-breaking change that enables testability.
