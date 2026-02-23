# Phase 16 (28) — SGX Integration Lessons

## Decision: Path B (integrate now with ~15x overhead)

Chose to integrate SGX with the current ~15x overhead (due to EPC paging on 8MB EPC) rather than waiting for EDMM support in Gramine. Rationale: the overhead is acceptable for a proof-of-concept, and EDMM in a future Gramine release will bring it within 5x without code changes.

## TCP protocol: length-prefixed framing

| Attempt | Approach | Result |
|---|---|---|
| 1 | Client sends JSON + `socket.end()`, server reads on `end` event, responds | Failed in Bun — `socket.end()` fully closes the socket, preventing the response from being received (Bun doesn't support TCP half-close like Node.js) |
| 2 | Length-prefixed framing on both sides: `[4-byte BE length][JSON]`. Client sends without calling `end()`, server reads based on length prefix and responds. Client reads response based on length prefix, then `socket.destroy()` | Works in both Bun and Node.js |

**Lesson**: Don't rely on TCP half-close in Bun. Use length-prefixed framing for reliable bidirectional communication.

## P-256 vs curve25519

Gramine's OpenSSL build lacks curve25519 support. The SGX worker uses P-256 OpenPGP keys. This is transparent to the SDK because `openpgp.readKey()` handles any key type.

## SGX attestation verification via Azure MAA

Used Azure MAA (Microsoft Azure Attestation) rather than implementing raw DCAP verification. MAA handles the complex PCK cert chain, TCB level, and QE identity verification. The SDK only needs to:
1. POST the raw quote to MAA
2. Verify the returned JWT (using `jose` library)
3. Check MRENCLAVE/MRSIGNER claims
4. Verify public key binding via user_report_data hash

## HARDWARE_CONCURRENCY=1

Phase 15E benchmarks showed that threading doesn't help in SGX (EPC paging dominates). Set `HARDWARE_CONCURRENCY=1` in both the worker and the manifest.

## bb prove invocation & proof format

| Attempt | Approach | Result |
|---|---|---|
| 1 | `execSync("bb prove ...")` with string command | Failed — Gramine blocks shell execution. `execFileSync` required |
| 2 | `execFileSync(BB_PATH, args)` with `-o ${tmpDir}/proof` (output file path) | Failed — `-o` flag expects output **directory**, not file path |
| 3 | `execFileSync(BB_PATH, args)` with `-o tmpDir` and tmpfs `/tmp` mount | Failed — Gramine `exec()` creates new enclave for child processes; tmpfs mounts are NOT shared between parent/child. bb couldn't read the IVC inputs file written by Node.js |
| 4 | Changed `/tmp` from tmpfs to passthrough mount in manifest | bb successfully read inputs and generated proof (86.3s, 93,216 bytes) |
| 5 | Raw proof returned to SDK | Failed — `ChonkProofWithPublicInputs.fromBuffer()` expects `[4-byte BE uint32: field count][N × 32-byte Fr fields]`, but bb CLI outputs raw field data without the length prefix |
| 6 | Added 4-byte BE uint32 length prefix (`fieldCount = rawProof.length / 32`) in worker before sending | Deployed. Format is correct (matches `ChonkProofWithPublicInputs.toBuffer()` format). E2e validation blocked by bb crash below. |

## bb heap corruption in SGX (consistent)

bb 5.0.0-nightly.20260223 crashes consistently at the 4th circuit (`private_kernel_inner`) during `ChonkAccumulate` with:
- "corrupted size vs. prev_size" (glibc heap corruption)
- "Invalid argument"

The crash is in bb itself, not in our wrapper code. The binary hash matches local (md5: `31c6baf7cf86b901afa54080ed7c9eb9`). The same binary works locally (4.2s, proofSize=2913). Inside SGX with 8MB EPC (everything else paged), bb processes 3 circuits then crashes on the 4th.

Previous successful run (86.3s, 93K proof) was with the same binary and inputs of similar structure. The crash may be caused by:
1. Memory corruption during EPC paging under pressure
2. glibc allocator issues with Gramine's page fault handler
3. Non-deterministic memory layout leading to intermittent corruption

**Next steps**: Try with a DCsv3 VM (which has 128MB EPC) instead of DCsv2 (8MB EPC), or investigate Gramine's malloc configuration.

**Key lesson**: Gramine `exec()` isolation means child processes (bb) get their own enclave with independent filesystem state. `tmpfs` mounts are per-enclave — use passthrough mounts for shared data between parent and child. Note: passthrough means decrypted data touches host filesystem — acceptable for spike, not production.

**Key lesson**: bb CLI outputs raw proof bytes, but Aztec's `ChonkProofWithPublicInputs.fromBuffer()` expects a 4-byte length prefix. The standard server-side prover (`BBLazyPrivateKernelProver`) returns `ChonkProofWithPublicInputs` directly from WASM, so this format difference only matters for CLI invocation.

## Msgpack serialization for SGX

The SDK now sends msgpack-serialized IVC inputs for SGX mode (using `serializePrivateExecutionSteps` from `@aztec/stdlib/kernel`), producing ~2.2MB vs ~11.7MB for JSON — a 5x reduction. The enclave worker writes the msgpack directly to disk for `bb prove --scheme chonk --ivc_inputs_path`.

## bb version matching

The bb binary on the VM must match the SDK's `@aztec/bb.js` version exactly. Mismatch between bb 4.0.0-devnet.2 and SDK 5.0.0-nightly.20260223 caused "The prove command for Chonk expect a valid file passed with --ivc_inputs_path" error. Fixed by uploading the matching amd64-linux binary from local `node_modules/.bun/@aztec+bb.js@5.0.0-nightly.20260223`.

## Production hardening

- Removed `loader.insecure__use_host_env = true` — all env vars hardcoded in manifest
- Set `sgx.debug = false` — prevents GDB attach and memory dumps
- Added `--scheme chonk` flag to bb prove command
- Added graceful SIGTERM shutdown handler
- Added health check action for monitoring
