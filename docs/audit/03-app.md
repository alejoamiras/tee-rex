# App Package Audit (`packages/app`)

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: All source, test, e2e, config files  

## Summary

The app is a well-structured Vite + vanilla TypeScript frontend with a custom build config handling WASM/worker edge cases. It has 40 unit tests and comprehensive fullstack e2e tests. Key concerns: `waitForTx()` has no max timeout (infinite loop risk), accessibility is poor (no ARIA, color-only indicators), `clearIndexedDB()` wipes ALL databases (not just Aztec), and `extractSimDetail()` uses `any` types without validation.

## Findings

### Critical

#### C1. `waitForTx()` infinite loop — no max timeout — RESOLVED (#67)
- **File**: `src/aztec.ts:307-316`
- **Code**: `while (true) { ... await new Promise(r => setTimeout(r, 1000)); }`
- **Issue**: If a transaction stays pending indefinitely (stuck sequencer, network partition), this loops forever. No max iteration count or timeout.
- **Impact**: Browser tab hangs permanently. User must force-close. No error reported.
- **Category**: Bug
- **Fix**: Add max timeout (e.g., 10 minutes): `const deadline = Date.now() + 10 * 60 * 1000; if (Date.now() > deadline) throw new Error("Transaction confirmation timed out");`
- **Effort**: Trivial
- **Resolution**: Added 10-minute deadline to `waitForTx()` polling loop. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

### High

#### H1. `clearIndexedDB()` deletes ALL databases, not just Aztec — RESOLVED (#67)
- **File**: `src/aztec.ts:88-91`
- **Code**: `const dbs = await indexedDB.databases(); await Promise.all(dbs.filter(db => db.name).map(db => indexedDB.deleteDatabase(db.name!)));`
- **Issue**: On retry, clears every IndexedDB database on the origin, including non-Aztec data.
- **Impact**: If deployed on a shared origin or if users have other apps at the same domain, their data is destroyed.
- **Category**: Bug
- **Fix**: Filter to known prefixes: `dbs.filter(db => db.name?.startsWith("pxe-") || db.name?.startsWith("wallet-"))`.
- **Effort**: Trivial
- **Resolution**: Scoped to `pxe-`, `wallet-`, `aztec-` prefixed databases only. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### H2. `extractSimDetail()` uses `any` without validation
- **File**: `src/aztec.ts:297-304`
- **Code**: `function extractSimDetail(simResult: { stats: { timings: any } }): SimStepDetail`
- **Issue**: Parameter type uses `any` for timings. Accesses `t.sync`, `t.total`, `t.perFunction` without checking they exist. If Aztec changes the timings shape, this crashes silently or returns wrong data.
- **Category**: Type Safety
- **Fix**: Define a type for expected timings shape, use optional chaining with defaults: `t?.sync ?? 0`.
- **Effort**: Small

#### H3. Accessibility is poor — no ARIA labels, color-only indicators
- **File**: `index.html` (multiple lines), `src/style.css`
- **Issue**: 
  - Status dots convey state via color only (green/red/gray) — no text alternative
  - Mode buttons and result cards lack `aria-label`
  - Log panel not marked as `role="log"` with `aria-live="polite"`
  - Disabled buttons don't explain why (no `title` attribute)
  - Progress spinner has no accessible name
- **Impact**: Screen readers and low-vision users cannot use the app.
- **Category**: Accessibility
- **Fix**: Add `aria-label` to status dots and buttons, `role="log"` to log panel, `title` on disabled buttons explaining "Not configured", `aria-busy` on progress container.
- **Effort**: Medium

### Medium

#### M1. State object is mutable global — no protection against concurrent mutations
- **File**: `src/aztec.ts:52-62`
- **Issue**: `export const state: AztecState` is a mutable global object. Multiple async operations (deploy, token flow) could mutate `state.registeredAddresses` concurrently.
- **Category**: Design
- **Fix**: Add the existing `deploying` flag from main.ts to prevent concurrent operations (already done at UI level), but document this as a design constraint.
- **Effort**: Trivial (documentation)

#### M2. Env var handling inconsistency — PROVER_URL vs process.env.PROVER_URL
- **File**: `src/aztec.ts:22, 28, 31`
- **Issue**: `PROVER_URL` is hardcoded to `"/prover"` (line 22) for the proxy path, but `PROVER_CONFIGURED` reads from `process.env.PROVER_URL` (line 31). This works because Vite `define` replaces `process.env.PROVER_URL` at build time, but it's confusing — two different values.
- **Category**: Code Clarity
- **Fix**: Add a comment explaining the distinction, or rename the constant to `PROVER_PROXY_PATH`.
- **Effort**: Trivial

#### M3. Vite `loadEnv` loads all env vars (no VITE_ prefix filtering)
- **File**: `vite.config.ts:77`
- **Code**: `loadEnv(mode, process.cwd(), "")`
- **Issue**: Third argument `""` means ALL env vars are loaded, not just `VITE_`-prefixed ones. Sensitive env vars (PATH, HOME, AWS credentials) could be accidentally exposed via `process.env` replacements.
- **Impact**: Low in practice (only specific vars are used in `define`), but violates Vite's security model.
- **Category**: Security
- **Fix**: Use `VITE_` prefix for app env vars or explicitly list which vars to expose in `define`.
- **Effort**: Small

#### M4. Log panel can grow unbounded — no max entries
- **File**: `src/ui.ts:20-35`
- **Issue**: `appendLog()` creates a new DOM element for each log line. No deduplication, rate limiting, or max entry count. Long-running sessions could bloat the DOM.
- **Category**: Performance
- **Fix**: Add max entries (e.g., keep last 500 lines, remove oldest when exceeded).
- **Effort**: Small

#### M5. `shortFnName()` doesn't handle edge cases
- **File**: `src/main.ts:93-96` (inferred from app analysis)
- **Issue**: If input is empty string or ends with ":", returns empty or unexpected result.
- **Category**: Robustness
- **Fix**: Add guard: `if (!name) return "unknown";`
- **Effort**: Trivial

#### M6. No error recovery for deploy/token flow failures
- **File**: `src/main.ts` (deploy button handler)
- **Issue**: When deploy fails, error is logged but no retry mechanism or actionable guidance shown to user. Button resets but user doesn't know why it failed or what to do.
- **Category**: UX
- **Fix**: Show error type in result card (e.g., "timeout — try again" or "server unreachable — check connection").
- **Effort**: Small

#### M7. `innerHTML` usage in main.ts — RESOLVED (#67)
- **File**: `src/main.ts` (step rendering)
- **Issue**: Uses `innerHTML` with template literals containing step data. While step names come from code (not user input), this is an XSS risk if the data source changes.
- **Category**: Security
- **Fix**: Use `textContent` + explicit DOM element creation instead of `innerHTML`.
- **Effort**: Small
- **Resolution**: Replaced all `innerHTML` with `buildDotRow()` helper using safe DOM APIs (`textContent`, `createElement`, `append`). PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

### Low

#### L1. `formatDuration()` doesn't handle negative input
- **File**: `src/ui.ts:37-39`
- **Issue**: If `ms < 0`, returns negative duration string.
- **Category**: Robustness
- **Fix**: `return \`${(Math.max(0, ms) / 1000).toFixed(1)}s\`;`
- **Effort**: Trivial

#### L2. oklch() CSS without browser fallback
- **File**: `src/style.css` (status dot glow)
- **Issue**: Uses `oklch()` color function which may not work in older browsers.
- **Category**: Browser Compatibility
- **Fix**: Add fallback RGB values before oklch declarations.
- **Effort**: Trivial

#### L3. Vite build target is `esnext`
- **File**: `vite.config.ts` (build config)
- **Issue**: May generate code too new for some browsers. SharedArrayBuffer already limits to modern browsers, so this is acceptable.
- **Category**: Browser Compatibility (accepted)
- **Fix**: None needed — users needing SharedArrayBuffer already have modern browsers.
- **Effort**: N/A

#### L4. Wallet state strings hardcoded in multiple places
- **File**: `src/main.ts` (multiple locations)
- **Issue**: "not initialized", "initializing...", "failed", "aztec unavailable" are string literals in multiple places.
- **Category**: Maintainability
- **Fix**: Extract to constants: `const WALLET_STATE = { NOT_INIT: "not initialized", ... }`.
- **Effort**: Trivial

#### L5. Test helpers mock prover with `as any`
- **File**: `src/aztec.test.ts:131-138`
- **Issue**: Creates mock prover object with `as any` cast. Fragile if TeeRexProver API changes.
- **Category**: Test Quality
- **Fix**: Create a typed mock helper or use `satisfies Partial<TeeRexProver>`.
- **Effort**: Small

## Positive Notes

- Solid feature flag mechanism (build-time env vars → boolean flags)
- Well-structured step timing breakdown (simulate, prove+send, confirm)
- Retry logic for wallet initialization (3 attempts with IDB clearing)
- Good Vite config: COOP/COEP headers, conditional proxies, WASM worker workaround
- Comprehensive fullstack e2e with serial mode and realistic flows
- Clean separation: aztec.ts (state/logic) → main.ts (UI glue) → ui.ts (DOM helpers)
- Proper finally blocks for interval cleanup
