# SDK Package Audit (`packages/sdk`)

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: All source, test, and e2e files  

## Summary

The SDK is well-architected with clean separation between local/remote proving, strong cryptographic verification (COSE_Sign1 + certificate chain), and good e2e test coverage. Key concerns: attestation unit tests only cover error paths (no happy-path tests), witness serialization has a known performance issue, and several unsafe type casts exist in attestation.ts.

## Findings

### Critical

None.

### High

#### H1. Attestation unit tests only cover error paths
- **File**: `src/lib/attestation.test.ts` (25 lines, 4 tests)
- **Issue**: All 4 tests verify invalid input rejection. Zero tests for valid attestation verification, certificate chain validation, signature verification, PCR checking, or freshness checks.
- **Impact**: The most security-critical code in the SDK has no unit-level happy-path coverage. A regression in verification logic could go undetected.
- **Category**: Testing
- **Fix**: Create attestation test fixtures (valid COSE_Sign1 + cert chain) and add tests for all 7 verification steps. This is the single highest-impact improvement.
- **Effort**: Medium (need to generate or capture real attestation docs)

#### H2. Witness serialization triple-encodes large data
- **File**: `src/lib/tee-rex-prover.ts:84-98`
- **Issue**: `jsonStringify(step.witness)` → `JSON.parse()` → `JSON.stringify()` for the HTTP payload. Witness maps can be >100MB for complex functions, causing ~300MB temporary allocations.
- **Impact**: Memory pressure and latency on large proofs. Already acknowledged with a TODO comment (line 98).
- **Category**: Performance
- **Fix**: Coordinate with Aztec stdlib for direct PrivateExecutionStep serialization. Or at minimum, skip the intermediate `JSON.parse()` step.
- **Effort**: Medium (depends on Aztec upstream)

### Medium

#### M1. Unsafe type casts in attestation.ts
- **File**: `src/lib/attestation.ts:70-75, 84, 177`
- **Issue**: `decodeCbor(raw) as [Uint8Array, ...]` casts unknown CBOR output without structural validation. Line 77-79 checks array length (good), but the inner types are assumed correct. Similarly line 84 casts payload to `Record<string, unknown>`, and line 177 casts `doc.pcrs as Map<number, Uint8Array>` after only checking `instanceof Map` (map contents not validated).
- **Impact**: Malformed CBOR could cause unexpected runtime errors. Mitigated by the downstream validation in `parseAttestationDocument()`.
- **Category**: Type Safety
- **Fix**: Add runtime validation of array element types after the CBOR decode, or use a schema validator like Zod.
- **Effort**: Small

#### M2. No retry logic for remote proving
- **File**: `src/lib/tee-rex-prover.ts:99-104`
- **Issue**: Single HTTP attempt with 5-min timeout. No retry on transient failures (network blips, 502/503 from load balancer).
- **Impact**: Users must implement retry logic themselves. For a proving operation that takes minutes, a transient failure wastes significant time.
- **Category**: Reliability
- **Fix**: Add configurable retry (e.g., `ky` has built-in retry support: `retry: { limit: 2, statusCodes: [502, 503] }`).
- **Effort**: Small

#### M3. No idempotency token for `/prove` requests
- **File**: `src/lib/tee-rex-prover.ts:99-104`
- **Issue**: If the client times out but the server completes the proof, re-sending creates a duplicate proof. No idempotency key sent with the request.
- **Impact**: Low in practice (proofs are deterministic), but wastes server resources.
- **Category**: Design
- **Fix**: Add a UUID request ID header and have the server cache results by ID.
- **Effort**: Medium

#### M4. `deploySchnorrAccount()` helper duplicated across e2e files
- **File**: `e2e/proving.test.ts` and `e2e/mode-switching.test.ts`
- **Issue**: Both files define their own account deployment helper. Not extracted to shared utils.
- **Impact**: Maintenance burden — changes need to happen in two places.
- **Category**: Code Quality
- **Fix**: Extract to `e2e/e2e-helpers.ts`.
- **Effort**: Trivial

#### M5. Attestation nonce field not validated
- **File**: `src/lib/attestation.ts:182`
- **Issue**: The `nonce` field is parsed from the attestation document but never validated by `verifyNitroAttestation()`. The caller receives the document but has no guidance on nonce checking.
- **Impact**: Attestation replay attacks are possible if the application doesn't validate nonces independently.
- **Category**: Security (documentation)
- **Fix**: Document in JSDoc and README that nonce validation is the caller's responsibility. Optionally add an `expectedNonce` field to `AttestationVerifyOptions`.
- **Effort**: Small

### Low

#### L1. Error class lacks error codes
- **File**: `src/lib/attestation.ts:215-220`
- **Issue**: `AttestationError` has only a message string. No error code or enum for programmatic handling.
- **Category**: DX
- **Fix**: Add `AttestationErrorCode` enum (INVALID_COSE, CHAIN_FAILED, SIGNATURE_FAILED, etc.).
- **Effort**: Small

#### L2. Clock skew not tolerated in freshness check — RESOLVED (#67)
- **File**: `src/lib/attestation.ts:112-117`
- **Issue**: Uses `Date.now() - attestationDoc.timestamp` with no tolerance for clock drift between client and enclave.
- **Impact**: If clocks differ by >30s, valid attestations could be rejected.
- **Category**: Robustness
- **Fix**: Add ±30s tolerance or document the assumption.
- **Effort**: Trivial
- **Resolution**: Added 30s `CLOCK_SKEW_TOLERANCE_MS` to freshness comparison. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### L3. Logger not configurable by SDK consumers
- **File**: `src/lib/logger.ts` (4 lines)
- **Issue**: Creates a fixed-category logger `["tee-rex"]`. SDK consumers cannot customize log output without configuring LogTape themselves.
- **Category**: DX
- **Fix**: Document how to configure LogTape for `["tee-rex"]` category in README.
- **Effort**: Trivial

#### L4. Missing JSDoc on public API methods
- **File**: `src/lib/tee-rex-prover.ts`
- **Issue**: `setProvingMode()`, `setApiUrl()`, `setAttestationConfig()`, `createChonkProof()` lack JSDoc comments.
- **Category**: Documentation
- **Fix**: Add JSDoc with param descriptions and usage examples.
- **Effort**: Trivial

## Positive Notes

- Clean class hierarchy (extends BBLazyPrivateKernelProver)
- Proper use of discriminated unions for attestation response parsing (line 116-124)
- Dynamic imports for crypto/cbor (browser-compatible SDK)
- Good E2E coverage across all proving modes with skip guards
- Zod schema validation on remote API responses
- Proper use of `UnreachableCaseError` for exhaustive switch
- Strong crypto: COSE_Sign1 + SHA384 + certificate chain + AWS Root CA pinning
