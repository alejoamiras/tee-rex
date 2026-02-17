# Server Package Audit (`packages/server`)

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: All source and test files  

## Summary

The server is compact (~370 lines of source) with clean dependency injection, proper structured logging, and reasonable test coverage (17 tests). Key concerns: the 50MB JSON body limit is a DoS vector, all error responses are generic 500s (no 400 for validation), no rate limiting on the expensive `/prove` endpoint, and the TEE_MODE env var is cast without validation.

## Findings

### Critical

None.

### High

#### H1. 50MB JSON body limit is a DoS vector — RESOLVED (#67)
- **File**: `src/index.ts:30`
- **Code**: `app.use(express.json({ limit: "50mb" })); // TODO: change to 1mb?`
- **Issue**: Attackers can send 50MB payloads to consume server memory. The TODO comment acknowledges this concern.
- **Impact**: Memory exhaustion on the EC2 instance. Combined with no rate limiting, multiple large requests could crash the server.
- **Category**: Security
- **Fix**: Measure actual payload sizes (likely 1-5MB after encryption) and reduce limit to 10MB max.
- **Effort**: Trivial
- **Resolution**: Reduced to 10MB, removed TODO comment. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### H2. No rate limiting on `/prove` endpoint — RESOLVED (#68)
- **File**: `src/index.ts:33-69`
- **Issue**: Proof generation is computationally expensive (1-5 minutes CPU). No rate limiting, API keys, or request queuing.
- **Impact**: A single client can monopolize the prover by submitting concurrent requests.
- **Category**: Security / Availability
- **Fix**: Add `express-rate-limit` with per-IP limits (e.g., 2 concurrent, 10/hour). Or add request queuing.
- **Effort**: Small
- **Resolution**: Added `express-rate-limit` with 10 requests/hour per IP on `/prove`. PR [#68](https://github.com/alejoamiras/tee-rex/pull/68).

### Medium

#### M1. All errors return generic 500 with "Internal server error" — RESOLVED (#68)
- **File**: `src/index.ts:91-96`
- **Issue**: The error handler returns `{ error: "Internal server error" }` for ALL errors: Zod validation failures, base64 decode errors, decryption failures, and actual server bugs.
- **Impact**: Clients cannot distinguish between bad requests (their fault) and server errors. Debugging is harder.
- **Category**: DX / Error Handling
- **Fix**: Return 400 for validation/parsing errors (ZodError, base64 decode), 408 for timeouts, 500 for unexpected errors.
- **Effort**: Small
- **Resolution**: Added structured error responses: ZodError → 400 with details, SyntaxError → 400 "Malformed request body", others → 500. PR [#68](https://github.com/alejoamiras/tee-rex/pull/68).

#### M2. TEE_MODE env var cast without runtime validation — RESOLVED (#67)
- **File**: `src/index.ts:104`
- **Code**: `const teeMode = (process.env.TEE_MODE || "standard") as TeeMode;`
- **Issue**: String from env var is cast to `TeeMode` without validation. If someone sets `TEE_MODE=invalid`, `createAttestationService()` will throw a generic error.
- **Category**: Robustness
- **Fix**: Use Zod to validate: `z.enum(["standard", "nitro"]).catch("standard").parse(process.env.TEE_MODE)`.
- **Effort**: Trivial
- **Resolution**: Replaced unsafe cast with `z.enum(["standard", "nitro"]).catch("standard").parse()`. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### M3. Base64 input not validated before decoding — RESOLVED (#67)
- **File**: `src/index.ts:37`
- **Code**: `const encryptedData = Base64.toBytes(req.body.data);`
- **Issue**: `req.body.data` could be any JSON value (number, null, object). No Zod validation on the request body before accessing `.data`. If `.data` is not a valid base64 string, `Base64.toBytes()` throws an untyped error.
- **Category**: Input Validation
- **Fix**: Add Zod schema for request body: `z.object({ data: z.string().min(1) }).parse(req.body)` before the Base64 decode.
- **Effort**: Trivial
- **Resolution**: Added `z.object({ data: z.string().min(1) }).safeParse()` with 400 error response. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### M4. No request logging or request IDs
- **File**: `src/index.ts:33-69`
- **Issue**: Proof requests are logged on completion (durationMs) but not on arrival. No request ID, client IP, or correlation token. Successful GET requests have no logging at all.
- **Category**: Observability
- **Fix**: Add request ID middleware (e.g., `crypto.randomUUID()`) and log at request start + end.
- **Effort**: Small

#### M5. ProverService not unit tested
- **File**: `src/lib/prover-service.ts` (63 lines)
- **Issue**: Only tested via mocked dependencies in `index.test.ts`. The actual prover initialization logic (Barretenberg binary resolution, fallback to WASM, eager init via setTimeout) has no dedicated unit tests.
- **Category**: Testing
- **Fix**: Add tests for binary resolution logic, lazy initialization behavior, and timing logging.
- **Effort**: Medium (requires mocking BBLazyPrivateKernelProver)

#### M6. NitroAttestationService untested (only factory tested)
- **File**: `src/lib/attestation-service.ts:68-100`
- **Issue**: The Nitro FFI code path (`getNitroAttestationDocument()`, `dlopen`, `dlsym`) cannot run outside a Nitro Enclave. No mock or stub tests exist.
- **Category**: Testing
- **Fix**: Test the logic around FFI (buffer preparation, response parsing) by mocking the native functions. The FFI calls themselves can't be tested outside an enclave.
- **Effort**: Medium

### Low

#### L1. `cors()` allows all origins
- **File**: `src/index.ts:29`
- **Issue**: Permissive CORS. Any website can call the server API.
- **Impact**: Acceptable for this architecture (server is behind CloudFront/VPC, requests are encrypted).
- **Category**: Security (accepted risk)
- **Fix**: None needed if deployment model stays the same. Document the assumption.
- **Effort**: N/A

#### L2. Legacy `/encryption-public-key` endpoint
- **File**: `src/index.ts:82-89`
- **Issue**: Exists for backward compatibility. Duplicates functionality of `/attestation`.
- **Category**: Technical Debt
- **Fix**: Deprecate after SDK consumers migrate to `/attestation`.
- **Effort**: Trivial

#### L3. Error handler logs `err` as `unknown` without structure
- **File**: `src/index.ts:93`
- **Code**: `logger.error("Unhandled error", { error: err });`
- **Issue**: `err` could be an Error, a string, or anything. LogTape may not serialize it usefully.
- **Category**: Observability
- **Fix**: Normalize: `{ error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }`.
- **Effort**: Trivial

#### L4. EncryptionService key generation failure not handled
- **File**: `src/lib/encryption-service.ts:21-30`
- **Issue**: If OpenPGP key generation fails, the error propagates and server can't serve any requests. No retry.
- **Impact**: Fast-fail is appropriate for crypto errors. Acceptable as-is.
- **Category**: Robustness (accepted)
- **Fix**: None needed. Document in code comments.
- **Effort**: N/A

## Positive Notes

- Clean dependency injection pattern (`createApp(deps)`)
- Proper try/catch on all async route handlers with `next(err)`
- Structured logging with LogTape (no console.log)
- Zod validation on decrypted payload (with Aztec schemas)
- `lazyValue()` utility prevents redundant initialization
- HEALTHCHECK in Dockerfile catches unresponsive containers
- ProverService eager init (`setTimeout(..., 1)`) warms up prover before first request
