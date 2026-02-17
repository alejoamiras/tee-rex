# Code Quality & Consistency Audit

**Date**: 2026-02-16  
**Status**: Complete  
**Current state**: Biome lint: 0 issues, TypeScript: 0 errors, 70 unit tests passing  

## Summary

Code quality is good overall: strict TypeScript, Biome enforcement, conventional commits, and clean architecture patterns. The codebase reads as mature and intentional. Key concerns: mutable global state in the app, some `any` types in non-trivial positions, test file organization could be tighter, and a few dead code / TODO items remain.

## Findings

### Medium

#### M1. Mutable global state in app package
- **File**: `packages/app/src/aztec.ts:52-62`
- **Issue**: `export const state: AztecState` is a plain mutable object. Any code that imports it can mutate any field at any time. No encapsulation, no events on state change, no protection against concurrent mutations.
- **Impact**: Hard to reason about state flow. UI inconsistencies if two async operations mutate state simultaneously.
- **Category**: Architecture
- **Note**: This is a demo app, not a production SPA. The simplicity is arguably appropriate for the scope. The `deploying` flag in main.ts prevents concurrent operations at the UI level.
- **Fix**: For presentation purposes, document this as an intentional design choice. For production, consider a state machine or event emitter.
- **Effort**: Large (if refactoring) / Trivial (if documenting)

#### M2. `any` types in meaningful positions
- **Files**:
  - `packages/app/src/aztec.ts:297`: `extractSimDetail(simResult: { stats: { timings: any } })`
  - `packages/app/src/aztec.ts:302`: `(t.perFunction ?? []).map((f: any) => ...)`
  - `packages/app/src/aztec.test.ts:131-138`: Mock prover with `as any`
  - `packages/sdk/src/lib/attestation.ts:70-84`: Unsafe casts from CBOR decode
- **Issue**: These `any` types suppress TypeScript's type checking at important boundaries (API responses, external data).
- **Category**: Type Safety
- **Fix**: Define types for Aztec simulation timings. Use Zod schemas for CBOR decode results. Use typed mock factories in tests.
- **Effort**: Small-Medium

#### M3. TODO comments in production code
- **Files**:
  - `packages/server/src/index.ts:30`: `// TODO: change to 1mb?`
  - `packages/sdk/src/lib/tee-rex-prover.ts:98`: `// TODO(perf): serialize executionSteps -> bytes without intermediate encoding`
- **Issue**: These TODOs represent known issues that haven't been addressed.
- **Category**: Technical Debt
- **Fix**: Either fix the issues or convert to tracked issues/backlog items.
- **Effort**: Varies

### Low

#### L1. Test file organization varies across packages
- **Issue**:
  - SDK: `src/lib/*.test.ts` + `e2e/` (clean separation)
  - Server: `src/index.test.ts` + `src/lib/*.test.ts` (clean)
  - App: `src/*.test.ts` + `e2e/` (clean) but e2e files have inconsistent naming: `demo.mocked.spec.ts` vs `local-proving.fullstack.spec.ts` vs `wallet-init.fullstack.spec.ts`
- **Category**: Consistency
- **Fix**: Standardize e2e naming to `<feature>.<project>.spec.ts` pattern.
- **Effort**: Trivial

#### L2. Import organization is consistent (enforced by Biome)
- **Positive observation**: Biome's `organizeImports: "on"` keeps imports sorted consistently across all files.
- No issue here.

#### L3. Naming conventions are mostly consistent
- **Positive**: camelCase for variables/functions, PascalCase for classes/types, SCREAMING_SNAKE for constants.
- **Minor inconsistency**: `executionsStepsSerialized` (line 84 in tee-rex-prover.ts) has a typo — `executions` should be `executionSteps` or `serializedSteps`.
- **Effort**: Trivial

#### L4. Factory function pattern used inconsistently
- **Issue**: Server uses `createApp(deps)` (factory pattern), `createAttestationService(mode)` (factory), but `EncryptionService` and `ProverService` use `new` directly. Not a problem, just inconsistent.
- **Category**: Consistency
- **Fix**: None needed — the pattern makes sense (stateful classes vs pure factories).
- **Effort**: N/A

#### L5. `plans/phase-4-testing-and-demo.md` is stale
- **File**: `plans/phase-4-testing-and-demo.md` (301 lines)
- **Issue**: Planning document from early phase. Not referenced anywhere.
- **Category**: Cleanup
- **Fix**: Move to `lessons/` or delete.
- **Effort**: Trivial

#### L6. Biome config is reasonable
- **File**: `biome.json`
- **Positive observations**:
  - `noExplicitAny: "off"` — pragmatic choice (Aztec interop needs `any`)
  - `noNonNullAssertion: "off"` — pragmatic (state.wallet! patterns)
  - `noUnusedImports: "warn"` — catches dead imports without blocking
  - `organizeImports: "on"` — enforces consistent ordering
  - `lineWidth: 100` — reasonable for modern screens
- No significant issues.

#### L7. TypeScript config is strict
- **File**: `tsconfig.json`
- **Positive observations**:
  - `strict: true` — all strict checks enabled
  - `noUncheckedIndexedAccess: true` — prevents undefined index access
  - `verbatimModuleSyntax: true` — enforces explicit type imports
  - `forceConsistentCasingInFileNames: true` — prevents cross-platform issues
- No issues.

## Overall Quality Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Architecture** | Excellent | Clean package separation, DI in server, SDK extends Aztec prover |
| **TypeScript** | Good | Strict mode, occasional `any` at boundaries |
| **Linting** | Excellent | Biome enforced, 0 issues, husky pre-commit |
| **Naming** | Good | Consistent conventions, one typo |
| **Error Handling** | Good | try/catch everywhere, custom error classes, but generic messages |
| **Logging** | Excellent | Zero console.log, structured LogTape throughout |
| **Commit Hygiene** | Excellent | Conventional commits, commitlint, lint-staged |
| **Dead Code** | Good | Minimal — two TODOs, one stale plan file |
| **Dependency Management** | Good | Pinned Aztec versions, exact openpgp pin, auto-update pipeline |
| **Test Quality** | Good | 70 tests, comprehensive e2e, but gaps in attestation + error paths |

## Code Metrics

| Metric | Value |
|--------|-------|
| Total source lines (excl. tests, config, docs) | ~1,900 |
| Total test lines | ~1,600 |
| Test-to-source ratio | ~0.84:1 (good) |
| Files with zero tests | 3 (logger.ts, prover-service.ts, logging.ts) |
| `any` count in source | ~8 occurrences |
| TODO count in source | 2 |
| Lint issues | 0 |
| Type errors | 0 |
