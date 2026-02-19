# TEE Enclave Stability — Lessons Learned

## STATUS: IN PROGRESS (2026-02-19)

## Context

Production TEE enclave on m5.xlarge (16GB, 4 vCPUs, 2 allocated to enclave) was crashing after ~9 minutes idle and immediately on `/prove` requests. This session diagnosed and partially fixed multiple root causes.

---

## Root Cause 1: Console buffer deadlock (FIXED, DEPLOYED)

**Symptom**: Enclave server becomes unresponsive after ~9 minutes in production mode (non-debug). In debug mode (`--debug-mode`), it runs indefinitely.

**Root cause**: The entrypoint script had `exec > /dev/console 2>&1`, which sends ALL process output to the serial console. In non-debug mode, nobody reads from the serial port (there's no `nitro-cli console` attached). The kernel's tty buffer is ~4KB. Once it fills from log output, `write()` blocks. Since Bun's event loop runs in a single thread, the blocked write deadlocks the entire server.

**Why debug mode works**: `nitro-cli console` attaches a reader that drains the buffer, so it never fills.

**Fix (in Dockerfile.nitro)**:
```bash
# Only startup messages go to /dev/console
exec > /dev/console 2>&1
echo "=== TEE-Rex Enclave Starting ==="
# ... startup logic ...

# Server and socat output goes to /dev/null
su appuser -s /bin/bash -c "bun run src/index.ts" > /dev/null 2>&1 &
socat VSOCK-LISTEN:5000,fork,reuseaddr TCP:localhost:${PORT} > /dev/null 2>&1 &

# After startup messages are done, redirect entrypoint itself to /dev/null
exec > /dev/null 2>&1
wait $SERVER_PID $SOCAT_PID
```

**Key insight**: Redirect per-process (server, socat) to /dev/null, AND redirect the entrypoint shell itself after startup messages are done. Both are needed — the entrypoint's `wait` can also trigger writes.

**How we diagnosed**: Ran enclave in debug mode — stable for 15+ minutes. Ran in production mode — crashed at ~9 minutes consistently. The only difference was the console reader.

---

## Root Cause 2: NSM dlopen file descriptor leak (FIXED, DEPLOYED)

**Symptom**: Could accelerate the crash timing by polling `/attestation` frequently.

**Root cause**: `attestation-service.ts` called `dlopen("libnsm.so")` on every `/attestation` request, opening a new library handle each time without ever closing it. Each handle leaks file descriptors until the process hits the FD limit.

**Fix**: Cache the library handle globally:
```typescript
let nsmLib: any;
async function getNsmLib() {
  if (nsmLib) return nsmLib;
  const { dlopen, FFIType } = await import("bun:ffi");
  nsmLib = dlopen("libnsm.so", { /* ... */ });
  return nsmLib;
}
```

---

## Root Cause 3: /prove OOM inside enclave (CONFIRMED, NOT YET FIXED)

**Symptom**: Server dies immediately when processing a `/prove` request. Enclave remains RUNNING but the Bun process inside is dead (curl to /attestation fails, socat proxy still listening).

**Evidence**:
- Console deadlock fix is deployed (new EIF built from fixed Dockerfile.nitro)
- Enclave runs stably for 15+ minutes with /attestation polling
- First /prove request kills the server every time
- No OOM visible from host (`dmesg`) — OOM happens inside the enclave, invisible from outside
- The prover EC2 (t3.xlarge, 16GB) handles the same proofs fine because Docker doesn't have enclave memory isolation overhead

**Analysis**: Barretenberg's `bb` native binary needs significant memory for proof generation. The 8192MB enclave has overhead from: Linux kernel (~200-500MB), Bun runtime (~200MB), Express + loaded Aztec modules (~500MB+), leaving ~7GB for `bb`. This appears insufficient.

**Status**: Needs either a larger instance (m5.2xlarge, 32GB) or memory optimization investigation.

---

## Lesson 4: Nitro hugepages allocator ordering (CRITICAL)

**Problem**: The allocator reserves hugepages from host RAM immediately when restarted. If set too high, it starves the host.

**Failure mode**: Set allocator to 12288MB on a 16GB host → only 4GB for host → Docker + nitro-cli build-enclave can't run → OOM → SSM agent becomes unresponsive → instance requires reboot.

**Correct deploy ordering**:
1. Reduce allocator to minimum (512MB) for the build phase
2. Pull Docker image + build EIF (needs host RAM)
3. Clean up Docker images
4. Increase allocator to target memory
5. Start enclave

**The current `ci-deploy.sh` has a bug**: It updates the allocator AFTER the EIF build (step 5), which is fine for the first deploy. But if a PREVIOUS deploy left the allocator high and the instance reboots, the allocator starts with the old high value, leaving insufficient host memory. The script should explicitly reduce the allocator at the START.

**Allocator config persists across reboots**: `/etc/nitro_enclaves/allocator.yaml` is a config file on disk. When the allocator service starts on boot, it reads this config and reserves that much hugepage memory immediately.

---

## Lesson 5: Docker Desktop buildx vs nitro-cli image format

**Problem**: `nitro-cli build-enclave` uses Linuxkit to extract Docker images. It requires standard Docker v2 manifest format. Docker Desktop's buildx can produce incompatible images.

**Failure**: `docker buildx build --push` → pushes OCI manifest with attestation manifest. `nitro-cli` fails with E48: "Linuxkit reported an error while creating the customer ramfs".

**Symptom**: `docker inspect` on the pulled image shows `"Cmd": null, "Entrypoint": null` even though the Dockerfile has both.

**Fix**: Build with `--load` first (loads into local daemon with correct Docker v2 format), then `docker push`:
```bash
docker buildx build --platform linux/amd64 \
  --provenance=false --sbom=false --load \
  -f Dockerfile.nitro -t $IMAGE_URI .
docker push $IMAGE_URI
```

**Key flags**: `--provenance=false` prevents attestation manifests. `--load` loads into local daemon. Push separately with `docker push`.

**CI doesn't have this issue**: GitHub Actions runners use Docker's standard builder, not buildx with provenance. This only affects local builds from Docker Desktop.

---

## Lesson 6: Hugepages fragmentation after EIF build

**Problem**: After building an EIF (which uses Docker overlay2 layers and significant memory), the host memory becomes fragmented. The allocator needs contiguous hugepage memory (2MB pages). Even if `free -m` shows enough total free memory, fragmented memory can't be used for hugepages.

**Failure**: Build EIF → Docker prune → try to allocate 12288MB hugepages → allocator fails because memory is fragmented.

**Mitigation**: Drop page caches before allocator restart: `echo 1 > /proc/sys/vm/drop_caches`. This helps but doesn't guarantee success for large allocations.

**Reality**: On a 16GB host, reliably allocating more than ~8-10GB of hugepages after an EIF build is difficult. If you need >8GB enclave memory on m5.xlarge, the allocator should be set BEFORE the build (but then the build can't run). This is a chicken-and-egg problem that requires a larger instance.

---

## Lesson 7: Boot persistence with systemd

**Problem**: After EC2 reboot, the enclave was not running. The EIF was stored in /tmp (wiped on reboot), and there was no systemd service to restart the enclave.

**Fix**: Two systemd services:
- `tee-rex-enclave.service`: Type=oneshot, RemainAfterExit=yes, runs nitro-cli with EnvironmentFile
- `tee-rex-proxy.service`: socat proxy, Restart=always, After/Requires enclave service

**Gotcha with oneshot + RemainAfterExit**: After `nitro-cli terminate-enclave --all` (manual), systemd still thinks the service is "active (exited)". `systemctl start` is a NO-OP. Must use `systemctl stop` first (runs ExecStop) or `systemctl restart`.

**EIF stored in /opt/tee-rex/**: Persists across reboots. ConditionPathExists prevents the service from starting if the EIF is missing.

---

## Lesson 8: socat /dev/vsock permissions

**Observation**: socat running as non-root user logs `W open("/dev/vsock", ...): Permission denied`. The vsock device requires root access inside the enclave.

**Fix**: Run socat as root in the entrypoint. socat only proxies bytes — no privilege escalation risk. The Bun server still runs as non-root appuser.

---

## Lesson 9: Debugging enclaves — debug vs production mode

**Debug mode** (`nitro-cli run-enclave --debug-mode`):
- `nitro-cli console` attaches to serial port (drains tty buffer)
- PCR0/PCR1/PCR2 are all zeros (attestation documents have empty measurements)
- Good for: console output, diagnosing crashes, verifying startup
- Bad for: testing real attestation, production behavior

**Production mode** (no `--debug-mode`):
- No console access (E44 error if you try)
- Real PCR measurements in attestation documents
- Serial port buffer can fill and deadlock processes (Root Cause 1)
- Only way to diagnose: restart in debug mode and reproduce

**Key insight**: A bug that only manifests in production mode (like the console deadlock) is very hard to diagnose because you can't see what's happening. The debug/production behavioral difference is the serial port reader.

---

## Attempt Log

| # | Approach | Result |
|---|----------|--------|
| 1 | Redeploy old EIF, 6144MB | Server crashes at ~9min (console deadlock) |
| 2 | Debug mode, 6144MB | Stable 15+ min (console reader drains buffer) |
| 3 | Cache NSM dlopen handle | Fixes FD leak, doesn't fix ~9min crash |
| 4 | Fix Dockerfile.nitro: redirect to /dev/null | Correctly fixes console deadlock |
| 5 | Increase to 8192MB, old EIF (no Dockerfile fix) | /attestation stable, /prove crashes server |
| 6 | Increase to 12288MB, old EIF | Allocator fails (host memory exhaustion during reboot) |
| 7 | Build new EIF from fixed Dockerfile locally | buildx manifest issue → E48 |
| 8 | Rebuild with --provenance=false --load + docker push | EIF builds successfully |
| 9 | Deploy new EIF, allocator 12288MB before build | Host OOM during build (allocator starves host) |
| 10 | Reboot + reduce allocator + build + try 12288MB after | Allocator fails (hugepage fragmentation) |
| 11 | Fall back to 8192MB with new EIF | Enclave runs, /attestation stable, /prove still crashes |

---

## Current State (2026-02-19)

- **Fixed and deployed**: Console deadlock (Dockerfile.nitro), NSM dlopen leak (attestation-service.ts), boot persistence (systemd services)
- **Not fixed**: /prove OOM — 8192MB enclave insufficient for Barretenberg proof generation
- **ci-deploy.sh needs update**: Allocator ordering fix (reduce before build, increase after)
- **Next step**: Either upgrade to m5.2xlarge (32GB, ~$0.384/hr) or investigate Barretenberg memory reduction

---

## Infrastructure Reference

- **TEE EC2**: i-0c1978dfd847c8440 (m5.xlarge, eu-west-2)
- **Prover EC2**: i-0817359c8affee06d (t3.xlarge, eu-west-2)
- **ECR**: 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex
- **CloudFront**: E1OVWK00AFOXHK (d3d1wk4leq65j7.cloudfront.net)
- **Allocator config**: /etc/nitro_enclaves/allocator.yaml
- **Enclave env**: /etc/tee-rex/enclave.env
- **EIF path**: /opt/tee-rex/tee-rex.eif
