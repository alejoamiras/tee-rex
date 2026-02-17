# Testing Gaps Audit

**Date**: 2026-02-16  
**Status**: Complete  
**Current state**: 70 unit tests (all passing), comprehensive e2e suites  

## Summary

Testing is decent for the project's stage — 70 unit tests across 3 packages plus comprehensive Playwright e2e. However, the most security-critical code (attestation verification) has minimal unit test coverage, the server has no integration tests for error scenarios, and there are no failure-injection tests anywhere.

## Test Inventory

| Package | Unit Tests | E2E Tests | Total |
|---------|-----------|-----------|-------|
| SDK | 13 (3 files) | 14+ (4 files) | ~27 |
| Server | 17 (4 files) | None (tested via SDK e2e) | 17 |
| App | 40 (2 files) | 20+ (4 files) | ~60 |
| Scripts | — | — | (covered in update-aztec-version.test.ts, 96 lines) |
| **Total** | **70** | **34+** | **~104** |

## Coverage Gaps by Severity

### Critical Gaps

#### G1. Attestation verification has no happy-path unit tests
- **File**: `packages/sdk/src/lib/attestation.test.ts` (25 lines, 4 tests)
- **What's tested**: Invalid CBOR, missing fields, wrong structure (error paths only)
- **What's NOT tested**:
  - Valid COSE_Sign1 decoding and parsing
  - Certificate chain verification (root → intermediates → leaf)
  - Signature verification with known-good data
  - PCR value matching
  - Freshness check (maxAgeMs boundary)
  - Public key extraction from valid document
  - All 7 verification steps described in the JSDoc
- **Impact**: The most security-critical code has ~20% coverage
- **Fix**: Generate test fixtures from a real Nitro Enclave attestation, or construct synthetic COSE_Sign1 structures with known signatures
- **Effort**: Medium-Large

### High Gaps

#### G2. Server error handling not tested — RESOLVED (#68)
- **File**: `packages/server/src/index.test.ts` (125 lines, 6 tests)
- **What's tested**: Happy path for all 3 endpoints, Zod validation
- **What's NOT tested**:
  - Invalid base64 in request body
  - Malformed JSON after decryption
  - Decryption failures (wrong key, corrupted data)
  - Request timeout behavior (5 min socket timeout)
  - Large payload handling (approaching 50MB limit)
  - Concurrent requests
  - Server startup/shutdown lifecycle
- **Effort**: Small-Medium
- **Resolution**: Added tests for missing body (400) and malformed JSON (400) error responses. PR [#69](https://github.com/alejoamiras/tee-rex/pull/69).

#### G3. No failure-injection tests in e2e
- **Files**: All e2e test files
- **What's NOT tested**:
  - Server goes down mid-proof
  - Network timeout during proving
  - Transaction dropped by sequencer
  - Attestation document expired
  - Invalid attestation (replay attack simulation)
  - Wallet initialization failure recovery
- **Impact**: Happy-path e2e tests give false confidence. Real production failures are not simulated.
- **Effort**: Medium

#### G4. ProverService has no dedicated unit tests
- **File**: `packages/server/src/lib/prover-service.ts` (63 lines)
- **What's NOT tested**:
  - Barretenberg binary resolution (arm64 vs amd64, macos vs linux)
  - WASM fallback logic
  - Eager initialization via setTimeout
  - Timing log output
- **Mitigated by**: SDK e2e tests exercise the prover end-to-end
- **Effort**: Medium (requires mocking BBLazyPrivateKernelProver)

### Medium Gaps

#### G5. App `deployTestAccount()` and `runTokenFlow()` not unit tested
- **File**: `packages/app/src/aztec.ts`
- **Issue**: These are the core business logic functions (~300 lines combined). Only tested via fullstack e2e (slow, flaky). No unit tests with mocked Aztec client.
- **Impact**: Logic bugs (step timing calculation, state mutations) only caught by expensive e2e runs.
- **Effort**: Medium (significant mocking required)

#### G6. NitroAttestationService FFI code path untested
- **File**: `packages/server/src/lib/attestation-service.ts:68-100`
- **Issue**: Cannot run outside Nitro Enclave. No mock tests for buffer preparation, CBOR encoding, or response parsing.
- **Impact**: Bugs in FFI code only discovered during deployment to actual enclave.
- **Effort**: Medium (need to mock dlopen/dlsym)

#### G7. Mocked app e2e tests don't verify step breakdown rendering
- **File**: `packages/app/e2e/demo.mocked.spec.ts`
- **Issue**: Tests verify initial state, mode toggling, and service status. Don't verify result card content, step breakdown, or timing display after a mocked deploy.
- **Effort**: Small

#### G8. No performance/benchmark tests
- **Issue**: No automated tests for proof generation timing, memory usage, or serialization overhead.
- **Impact**: Performance regressions go unnoticed.
- **Effort**: Medium (need baseline measurements and tolerance thresholds)

### Low Gaps

#### G9. `waitForTx()` infinite loop not tested
- **File**: `packages/app/src/aztec.ts:307-316`
- **Issue**: No test verifies timeout behavior (because there IS no timeout — see app audit C1).
- **Effort**: Trivial (after fixing the bug)

#### G10. Encrypt module edge cases
- **File**: `packages/sdk/src/lib/encrypt.test.ts`
- **What's NOT tested**: Empty data, very large data (memory limits), concurrent encryption calls.
- **Effort**: Trivial

#### G11. App test helpers use `as any` casts
- **File**: `packages/app/src/aztec.test.ts:131-138`
- **Issue**: Mock prover created with `as any`. If TeeRexProver API changes, tests won't catch the type mismatch.
- **Effort**: Small

## Recommendations (Priority Order)

1. **[Critical]** Add happy-path attestation unit tests with real/synthetic fixtures
2. **[High]** Add server error handling tests (bad input, timeouts, concurrent)
3. **[High]** Add at least one failure-injection e2e test (server-down-mid-proof)
4. **[Medium]** Add unit tests for `deployTestAccount()` with mocked Aztec client
5. **[Medium]** Add mocked Playwright test for result card rendering
6. **[Low]** Add performance baseline tests for serialization
