# Wallet Init Hang After test-wallet Migration

**Date**: 2026-02-13
**Context**: Migrating from `@aztec/test-wallet` to `@aztec/wallets/embedded` (commit 4ea1081)

## Problem 1: Wallet Init Hang

After switching from `TestWallet.create()` to manual `EmbeddedWallet` construction, the frontend hung at "Creating wallet (may take a moment)..." and never progressed.

### Root Cause

**`getPXEConfig()` defaults `proverEnabled: true`** (since spartan versions).

The old code only enabled proving on live networks:
```typescript
...(state.isLiveNetwork && { proverEnabled: true })
```

The new code relied on `getPXEConfig()` defaults, which set `proverEnabled: true` unconditionally. On a local sandbox (`realProofs: false`), this caused `createPXE()` to attempt full barretenberg WASM prover initialization in the browser, which hangs.

### Contributing Factor

The `l1Contracts` were also not passed in the PXE config. Both the old code and gregoswap's reference implementation pass them explicitly to avoid extra async fetches during PXE init.

### Fix

| Change | Before | After |
|--------|--------|-------|
| `proverEnabled` | `getPXEConfig()` default (`true`) | `state.proofsRequired` (false for sandbox) |
| `l1Contracts` | Not in config | Passed from pre-fetched data |
| `WalletDB.init` | Missing required `userLog` arg | `(msg) => log(msg)` |
| Diagnostic logging | None between steps | Log before/after PXE init, WalletDB creation |

### Result

Wallet init went from **infinite hang** to **2.8 seconds** on local sandbox.

---

## Problem 2: Local IVC Proving Hang (200+ seconds)

When connecting to a live network (nextnet) or forcing `proverEnabled: true`, the frontend hung indefinitely during ClientIVC proof generation in the browser.

### Root Cause

**Vite's dep optimizer breaks bb.js Web Worker loading** (Vite bug [#8427](https://github.com/vitejs/vite/issues/8427)).

Barretenberg (`@aztec/bb.js`) spawns Web Workers using:
```javascript
new Worker(new URL('./main.worker.js', import.meta.url), { type: 'module' })
```

When Vite pre-bundles bb.js, `import.meta.url` changes to point at `.vite/deps/` — but the worker files aren't copied there. The browser requests `.vite/deps/main.worker.js` which doesn't exist, causing the Worker to fail silently and IVC proving to hang forever.

### Investigation Attempts

| # | Approach | Result |
|---|----------|--------|
| 1 | Add `@aztec/bb.js` to `optimizeDeps.exclude` | **BROKE** — other pre-bundled @aztec chunks can't resolve `@aztec/bb.js` import from `.vite/deps/chunk-*.js` |
| 2 | Exclude ALL `@aztec/*` packages from optimizeDeps | **BROKE** — CJS transitive deps (e.g. `util`) can't provide named ESM exports when not pre-bundled. Error: `'util' does not provide export 'inspect'` |
| 3 | Custom Vite plugin (`bbWorkerPlugin`) to redirect worker requests | **WORKED** — intercepts broken `.vite/deps/main.worker.js` requests and serves from original node_modules path via `/@fs/` |

### Fix

Added a `bbWorkerPlugin()` in `vite.config.ts` that:
1. On startup, resolves the real paths to `main.worker.js` and `thread.worker.js` in `@aztec/bb.js`
2. Adds middleware that intercepts requests for these files from `.vite/deps/` and rewrites the URL to `/@fs/<real-path>`

This is a workaround for Vite 6.x. The root cause is fixed in **Vite 8** ([PR #21434](https://github.com/vitejs/vite/pull/21434)) — remove the plugin after upgrading.

### Result

ClientIVC proof generation: **14.3 seconds** (was infinite hang).
Full deploy with real proofs: **51.7 seconds**.
Multi-threaded WASM workers: working correctly (14 threads).

---

## Key Takeaways

1. When manually constructing what a factory method (`BrowserEmbeddedWallet.create()`) normally does, check ALL defaults the factory sets.
2. `getPXEConfig()` defaults are tuned for production (proofs on). Sandbox usage must override `proverEnabled: false`.
3. Always pass `l1Contracts` in PXE config when available to avoid redundant node fetches.
4. The `WalletDB.init()` signature changed to require a `LogFn` second argument.
5. Vite's dep optimizer can't handle `new URL('./file', import.meta.url)` patterns in pre-bundled dependencies. Excluding individual packages causes cascading failures. A middleware redirect plugin is the cleanest workaround for Vite 6.x.
6. When debugging browser WASM workers, check Vite's terminal output for "file does not exist" warnings — they indicate the optimizer broke asset resolution.
