# Phase 16 (28) — SGX Integration Lessons

## Decision: Path B (integrate now)

Chose to integrate SGX with the current overhead rather than waiting for EDMM support in Gramine. The DC4ds_v3 VM has 16GB EPC (not 8MB as initially assumed), so EPC paging is not the bottleneck. With `MALLOC_ARENA_MAX=1`, bb completes successfully in ~52s inside SGX (vs ~11s outside SGX, ~5x overhead). EDMM in a future Gramine release may reduce this further.

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

## bb heap corruption in SGX — RESOLVED with MALLOC_ARENA_MAX=1

### The crash

bb 5.0.0-nightly.20260223 crashed consistently at the 4th circuit (`private_kernel_inner`) during `ChonkAccumulate` with:
- "corrupted size vs. prev_size" (glibc heap corruption)
- "Invalid argument"

**Confirmed: SGX-only issue.** The same bb binary with the same msgpack data succeeds outside SGX on the same VM (4 threads, 283 MiB peak, 93,216-byte proof). Inside the Gramine enclave, bb processed 3 circuits then crashed deterministically on the 4th.

**EPC is NOT the bottleneck.** The DC4ds_v3 VM has 16GB EPC (`0x400000000`), and `sgx.enclave_size = "4G"`. bb's 283MB working set fits comfortably.

### Debugging

| Attempt | Approach | Result |
|---|---|---|
| 1 | Reduced `sgx.enclave_size` from 16G to 4G | Same crash — not an enclave size issue |
| 2 | Enabled `log_level=trace` in manifest | bb ran as child process [P2:T12:bb] via Gramine `exec()`, syscall trace visible |
| 3 | Added `MALLOC_ARENA_MAX=1` to manifest | **FIXED** — bb completed all 11 circuits, 93,216-byte proof, HTTP 200 in 52s |

### Root cause

glibc allocates a 64MB per-thread malloc arena by default. With `sgx.max_threads=32`, the child enclave (bb) could allocate up to 2GB just for arenas — competing with bb's 283MB working set inside the 4G enclave. The arena metadata corruption caused "corrupted size vs. prev_size" when glibc tried to reuse arena memory.

`MALLOC_ARENA_MAX=1` forces all threads to share a single arena, reducing memory overhead and eliminating the corruption. Since bb runs single-threaded (`HARDWARE_CONCURRENCY=1`), there's no performance penalty.

### Key takeaway

**Always set `MALLOC_ARENA_MAX=1` in Gramine manifests for memory-intensive workloads.** glibc's per-thread arena allocation interacts badly with SGX enclave memory limits. The default arena count (`8 × CPU cores`) can consume gigabytes of virtual address space that Gramine must back with EPC or swap.

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
