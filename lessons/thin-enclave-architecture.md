# Phase 33: Thin Enclave Architecture — Lessons

## Overview

Split monolithic server into host Express + thin enclave Bun.serve. Host manages bb downloads/uploads, enclave handles keys, attestation, decryption, proving. bb SHA256 hashes embedded in NSM attestation `user_data`.

## Implementation Approach

| Step | Approach | Result |
|------|----------|--------|
| 1. Protocol types + bb hashing | New `enclave-protocol.ts` (shared types), `bb-hash.ts` (SHA256 + cache) | Worked — clean foundation |
| 2. Attestation userData | Add optional `userData: Uint8Array` to `AttestationService.getAttestation()`, pass to NSM FFI | Worked — backward compatible (undefined = no userData) |
| 3. Thin enclave service | `Bun.serve()` with routes: /upload-bb, /prove, /attestation, /public-key, /health | Worked — 12 tests, atomic uploads |
| 4. bb download + enclave client | Port accelerator download logic to TS, typed HTTP client | Worked — URL matches accelerator pattern |
| 5. Host proxy mode | `AppMode` discriminated union: standard vs proxy. Proxy forwards to enclave | Worked — existing tests unchanged, 6 new proxy tests |
| 6. Docker + deploy script | Remove bb baking from Dockerfiles, rewrite deploy script | Worked — EIF shrinks significantly |
| 7. CI/CD workflows | Rename prover→host, pass bb_versions as runtime input | Worked — actionlint clean |
| 8. SDK attestation | `parseEnclaveUserData()`, extend `verifyNitroAttestation` return type | Worked — backward compatible |
| 9. Host crash-loop fix | Diagnosed via SSM: host exits code 0 ~1s after starting. Bun's `node:http` compat doesn't ref the server handle → event loop drains. Fix: `setInterval(() => {}, 1 << 30)` + clear on SIGTERM. | Worked — verified on CI instance |

## Key Learnings

1. **Bun.serve body types**: `Uint8Array` is not directly assignable to fetch `body` in TypeScript strict mode. Use `Buffer.from()` or `ArrayBuffer` instead.

2. **cbor-x encodes Uint8Array with CBOR tag 64**: The COSE Sig_structure requires plain bstr, so use `Buffer.alloc(0)` for empty external_aad (not `new Uint8Array(0)`).

3. **Backward compatibility is key**: The `AppMode` discriminated union allows both standard (legacy) and proxy (new) modes in the same codebase. All existing tests use standard mode unchanged.

4. **Attestation user_data for binary identity**: Instead of baking bb into the EIF (making PCR0 cover everything), embed bb SHA256 in user_data. NSM hardware-signs it. Clients verify PCR0 (code) + bb_hash (binary). Equivalent security, better auditability.

5. **Atomic file operations**: Upload bb to temp dir, compute hash, rename to final path. Prevents partial uploads from corrupting the cache.

6. **Bun event loop + Express**: Bun's `node:http` compatibility layer does NOT ref the HTTP server handle. Express's `server.listen()` won't keep Bun's event loop alive — the process exits with code 0 immediately after startup. Fix: `setInterval(() => {}, 1 << 30)` as a keep-alive, cleared on SIGTERM for clean shutdown. Affects both standard and proxy modes. Bun.serve (used in enclave) doesn't have this issue.

7. **Bun + privileged ports**: Bun's `node:http` silently fails to bind privileged ports (< 1024) as non-root — fires the listen callback without actually creating a socket. `ss -tlnp` shows nothing on port 80 despite "Server started" log. Works fine on non-privileged ports (8080). Fix: `sysctl -w net.ipv4.ip_unprivileged_port_start=80` in deploy script before starting the container. Avoids running as root while keeping port 80 for CloudFront compatibility.

8. **Proxy /health resilience**: Host `/health` must not fail when enclave is unreachable — deploy script checks host health independently (step 11). Catch enclave fetch errors in the health handler and return `{ status: "ok", enclave: "unreachable" }` with empty versions. Add AbortSignal.timeout(5s) to enclave health fetch to prevent hanging.

## Test Coverage

- `bb-hash.test.ts`: 3 tests (hash computation, cache operations)
- `enclave.test.ts`: 12 tests (all routes + error cases)
- `bb-download.test.ts`: 3 tests (URL construction, cache hit, extraction)
- `enclave-client.test.ts`: 6 tests (all client methods + errors)
- `index.test.ts`: 6 new proxy mode tests + all existing standard mode tests
- `attestation.test.ts` (SDK): 5 new parseEnclaveUserData tests
- `attestation-service.test.ts`: 3 new userData tests
- Total: 282 tests passing (49+1skip SDK, 96 server, 137 app)
