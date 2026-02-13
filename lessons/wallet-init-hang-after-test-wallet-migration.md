# Wallet Init Hang After test-wallet Migration

**Date**: 2026-02-13
**Context**: Migrating from `@aztec/test-wallet` to `@aztec/wallets/embedded` (commit 4ea1081)

## Problem

After switching from `TestWallet.create()` to manual `EmbeddedWallet` construction, the frontend hung at "Creating wallet (may take a moment)..." and never progressed.

## Root Cause

**`getPXEConfig()` defaults `proverEnabled: true`** (since spartan versions).

The old code only enabled proving on live networks:
```typescript
...(state.isLiveNetwork && { proverEnabled: true })
```

The new code relied on `getPXEConfig()` defaults, which set `proverEnabled: true` unconditionally. On a local sandbox (`realProofs: false`), this caused `createPXE()` to attempt full barretenberg WASM prover initialization in the browser, which hangs.

## Contributing Factor

The `l1Contracts` were also not passed in the PXE config. Both the old code and gregoswap's reference implementation pass them explicitly to avoid extra async fetches during PXE init.

## Fix

| Change | Before | After |
|--------|--------|-------|
| `proverEnabled` | `getPXEConfig()` default (`true`) | `state.isLiveNetwork` (false for sandbox) |
| `l1Contracts` | Not in config | Passed from pre-fetched data |
| `WalletDB.init` | Missing required `userLog` arg | `(msg) => log(msg)` |
| Diagnostic logging | None between steps | Log before/after PXE init, WalletDB creation |

## Result

Wallet init went from **infinite hang** to **2.8 seconds** on local sandbox.

## Investigation Attempts

| # | Approach | Result |
|---|----------|--------|
| 1 | Research gregoswap reference impl | Found l1Contracts difference + proverEnabled explicitly set |
| 2 | Research Aztec PR #20360 (test-wallet deprecation) | Confirmed API changes, WalletDB.init signature change |
| 3 | Check `getPXEConfig()` in node_modules | Found `proverEnabled` defaults to `true` via `booleanConfigHelper(true)` |
| 4 | Apply both fixes + diagnostic test | Fixed in one attempt, 2.8s init time |

## Key Takeaways

1. When manually constructing what a factory method (`BrowserEmbeddedWallet.create()`) normally does, check ALL defaults the factory sets.
2. `getPXEConfig()` defaults are tuned for production (proofs on). Sandbox usage must override `proverEnabled: false`.
3. Always pass `l1Contracts` in PXE config when available to avoid redundant node fetches.
4. The `WalletDB.init()` signature changed to require a `LogFn` second argument.
