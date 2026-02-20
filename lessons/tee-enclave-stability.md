# TEE Enclave Stability — Lessons Learned

## STATUS: RESOLVED (2026-02-19)

## Context

Production TEE enclave on m5.xlarge (16GB, 4 vCPUs, 2 allocated to enclave) was crashing after ~9 minutes idle and immediately on `/prove` requests. This session diagnosed and fixed all root causes across 14 attempts.

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

## Root Cause 3: /prove crashes — TWO application-level errors (FIXED, DEPLOYED)

**Symptom**: Server dies when processing a `/prove` request. Enclave remains RUNNING but the Bun process inside is dead (curl to /attestation fails, socat proxy still listening).

**Initial wrong hypothesis**: OOM inside enclave (8192MB insufficient for Barretenberg). WRONG — `dmesg` shows NO OOM and NO killed processes on the host. The kernel OOM killer was never triggered.

**Actual root causes** (found via debug mode enclave with console logging):

### 3a: express-rate-limit throws on X-Forwarded-For (FIXED)

**Error**: `ValidationError: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` — express-rate-limit v8 validates that Express's `trust proxy` setting is configured when `X-Forwarded-For` header is present. CloudFront always sends this header. The error is thrown from the rate limiter middleware before the `/prove` handler's try/catch, crashing the process.

**Fix**: `app.set("trust proxy", 1)` in Express setup. Must be `1` (not `true`) — `true` triggers `ERR_ERL_PERMISSIVE_TRUST_PROXY` because it trusts all proxy hops.

### 3b: Barretenberg CRS download fails — no internet in Nitro Enclave (FIXED)

**Error**: `BBApiException: HTTP request failed for http://crs.aztec-labs.com/g1.dat: Could not establish connection` — the native `bb` binary tries to download the CRS (Common Reference String) from the internet. Nitro Enclaves have NO network access — only vsock for communication.

**CRS resolution order in bb**:
1. Check `CRS_PATH` env var
2. Fall back to `$HOME/.bb-crs/`
3. Download from `crs.aztec-cdn.foundation` (primary) or `crs.aztec-labs.com` (fallback)

**Files needed**:
- `bn254_g1.dat`: partial download (2^23 points × 64 bytes = 512 MB covers any Aztec circuit)
- `bn254_g2.dat`: 128 bytes (full)
- `grumpkin_g1.flat.dat`: ~16 MB (full)

**Fix**: Pre-cache CRS during Docker build in `Dockerfile.nitro`:
```dockerfile
ENV CRS_PATH=/crs
RUN mkdir -p /crs && \
    curl -fSL -H "Range: bytes=0-536870911" https://crs.aztec-cdn.foundation/g1.dat -o /crs/bn254_g1.dat && \
    curl -fSL https://crs.aztec-cdn.foundation/g2.dat -o /crs/bn254_g2.dat && \
    curl -fSL https://crs.aztec-cdn.foundation/grumpkin_g1.dat -o /crs/grumpkin_g1.flat.dat
```

**Key insight**: The non-TEE prover EC2 works fine because it has internet — bb downloads CRS on first use. The TEE enclave is the only environment where CRS pre-caching is needed.

**How we diagnosed**: Built a debug EIF with server output redirected to `/dev/console` instead of `/dev/null`. Deployed in debug mode, attached `nitro-cli console` to capture output, then triggered a `/prove` request. The console log showed both errors clearly. NOTE: The initial console capture failed because `nitro-cli console --enclave-name tee-rex` used the wrong name (enclave was auto-named `tee-rex-debug` from the EIF filename). Fix: use `--enclave-id` from `nitro-cli describe-enclaves`.

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

## Lesson 9: Barretenberg CRS file naming and resolution (CRITICAL)

The Barretenberg `bb` native binary requires CRS (Common Reference String / Structured Reference String) data to generate proofs. Understanding the exact file names, URLs, and resolution order is critical — getting any of these wrong means silent failures or cryptic errors.

### CRS path resolution order

1. `CRS_PATH` environment variable (checked first)
2. `$HOME/.bb-crs/` directory (default fallback)
3. HTTP download from CDN (last resort — fails in offline environments)

### File names — URL vs local names DIFFER

| CDN URL | Local file name | Size |
|---------|----------------|------|
| `https://crs.aztec-cdn.foundation/g1.dat` | `bn254_g1.dat` | Up to 6.4 GB (full), use Range header for partial |
| `https://crs.aztec-cdn.foundation/g2.dat` | `bn254_g2.dat` | 128 bytes |
| `https://crs.aztec-cdn.foundation/grumpkin_g1.dat` | `grumpkin_g1.flat.dat` | ~16 MB |

**CRITICAL**: The file names on the CDN (`g1.dat`, `g2.dat`, `grumpkin_g1.dat`) do NOT match the local file names (`bn254_g1.dat`, `bn254_g2.dat`, `grumpkin_g1.flat.dat`). If you download with the wrong name, bb won't find them and will try to re-download. This is the most common mistake.

### CDN hosts (with fallback)

- **Primary**: `https://crs.aztec-cdn.foundation` (Cloudflare R2)
- **Fallback**: `https://crs.aztec-labs.com` (AWS S3)

### Partial downloads for bn254_g1.dat

The full `g1.dat` is 6.4 GB (100M points × 64 bytes/point). You almost never need the full file. The bb binary checks if the local file has enough bytes for the required circuit size: `file_size >= num_points * 64`.

For Aztec private kernel / ClientIVC proofs, 2^23 points (512 MB) covers all known circuits. Use HTTP Range header:
```bash
curl -fSL -H "Range: bytes=0-536870911" https://crs.aztec-cdn.foundation/g1.dat -o /crs/bn254_g1.dat
```

If the CRS is too small for a circuit, bb will error with a message indicating how many points it needs. Increase the range and re-download.

### Grumpkin CRS

The TypeScript layer (`@aztec/bb.js`) initializes Grumpkin CRS with 2^16 + 1 points (~4 MB). The full file on CDN is 16 MB (2^18 points). Download the full file to be safe.

### Where this matters

- **Nitro Enclaves**: NO internet access. Must pre-cache during Docker build.
- **Regular Docker/EC2**: Has internet, downloads on first use. Pre-caching saves ~30s on first proof.
- **CI**: Usually has internet. Pre-caching in base image speeds up CI proofs.

### Reference: bb.js TypeScript CRS code

- `@aztec/bb.js/src/crs/node/index.ts` — `Crs` and `GrumpkinCrs` classes handle filesystem cache + download
- `@aztec/bb.js/src/crs/net_crs.ts` — `NetCrs` and `NetGrumpkinCrs` classes handle HTTP download with Range headers
- Native bb binary: uses same `CRS_PATH` / `$HOME/.bb-crs` resolution, same file names

---

## Lesson 10: express-rate-limit trust proxy validation (v8+)

`express-rate-limit` v8 added strict validation of Express's `trust proxy` setting. Three possible states:

| `trust proxy` value | Result |
|---|---|
| `false` (default) + `X-Forwarded-For` present | Throws `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` |
| `true` | Throws `ERR_ERL_PERMISSIVE_TRUST_PROXY` (too open, anyone can spoof IPs) |
| `1` (or specific number/subnet) | Works correctly — trusts N proxy hops |

**For servers behind CloudFront**: Use `app.set("trust proxy", 1)` — one hop (CloudFront). This applies to BOTH the TEE enclave server AND the regular prover server (both behind CloudFront origins).

**Note**: This validation is new in express-rate-limit v8. If you downgrade to v7, neither error occurs (but IP detection is still wrong without trust proxy).

---

## Lesson 11: Debugging enclaves — debug vs production mode

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

## Lesson 12: nitro-cli console --enclave-name vs --enclave-id

`nitro-cli console` accepts either `--enclave-name` or `--enclave-id`. The enclave name is auto-generated from the EIF filename (e.g., `tee-rex-debug.eif` → enclave named `tee-rex-debug`, not `tee-rex`).

**Failure**: `nitro-cli console --enclave-name tee-rex` silently fails (E58 naming error) when the enclave is actually named `tee-rex-debug`. The console capture file is populated with the error message, not the enclave output. This looks like the enclave produced no output, wasting an entire debugging cycle.

**Fix**: Always use `--enclave-id` from `nitro-cli describe-enclaves`, never guess the name:
```bash
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli console --enclave-id $ENCLAVE_ID
```

---

## Lesson 13: Don't assume OOM — check dmesg first

When a process dies inside a Nitro Enclave, the natural assumption is OOM (the enclave has limited memory). **Always verify with `dmesg` on the host before pursuing the OOM hypothesis.**

In this session, we spent multiple attempts increasing memory (6GB → 8GB → 12GB) based on the OOM assumption. Checking `dmesg | grep -i "oom\|killed"` showed NO OOM kills. The actual cause was application-level errors (X-Forwarded-For validation + no internet for CRS download).

**Diagnostic order for enclave process death:**
1. `dmesg | grep -i "oom\|killed"` on the host — rules out kernel OOM killer
2. Restart in debug mode, capture console output — reveals application errors
3. Use `--enclave-id` (not `--enclave-name`) for console capture
4. Only then consider memory if dmesg shows actual OOM kills

---

## Lesson 14: Nitro Enclaves have NO network — implications beyond HTTP

Nitro Enclaves communicate exclusively via vsock. There is no TCP/IP, no DNS, no internet. This affects any code path that makes network requests at runtime:

- **CRS download** (Barretenberg): fails with "Could not establish connection"
- **npm/package downloads**: impossible at runtime
- **Telemetry/logging services**: won't reach external endpoints
- **NTP/time sync**: enclave uses host time via hypervisor, not NTP
- **DNS resolution**: `localhost` works (after `ifconfig lo 127.0.0.1`), but nothing else resolves

**Design principle**: Everything the enclave needs at runtime must be baked into the Docker image at build time, or passed through vsock.

---

## Lesson 15: Manual deploy vs systemd — don't mix

When deploying manually (via SSM + `nitro-cli run-enclave`), the systemd services don't know the enclave is running. Attempting `systemctl start tee-rex-proxy` fails because its dependency `tee-rex-enclave.service` reports as inactive.

**Options:**
1. **Full systemd deploy**: Use `systemctl start tee-rex-enclave` (which calls nitro-cli internally), then `systemctl start tee-rex-proxy`
2. **Full manual deploy**: Run nitro-cli manually AND start socat manually (`nohup socat ... & disown`)

Never mix: don't start the enclave manually then try to start the proxy via systemd. The dependency chain breaks.

---

## Lesson 16: SSM command output truncation and escaping

AWS SSM `RunShellScript` has several gotchas:
- **Output limit**: ~24KB. Larger outputs are silently truncated. Filter/tail logs before capturing.
- **JSON escaping in --parameters**: Shell special characters (`$!`, `\"`, backticks) need careful escaping. Using a JSON file with `file://` prefix is more reliable than inline JSON.
- **grep patterns**: `grep -v "^\["` to filter kernel boot lines from enclave console — the `\[` needs double escaping in JSON strings.
- **Pipeline exit codes**: `curl -sf | head -c 40 || echo DEAD` — `head` always exits 0 even with empty input, so the `||` never triggers. Write curl output to a file and check the exit code separately.

---

## Lesson 17: Hugepage re-allocation requires aggressive cleanup (CRITICAL)

**Problem**: The deploy script (`ci-deploy.sh`) reduced the allocator from 8192MB → 512MB at the start of each deploy, built the EIF, then tried to re-increase to 8192MB. This failed intermittently because the allocator restart happened without cleaning up first — Linuxkit and Docker left host memory fragmented, preventing contiguous 2MB hugepage allocation.

**Disproven hypothesis**: "Keep hugepages at 8192MB permanently and skip the reduce/increase cycle." Tested via SSM on prod instance — Linuxkit (used by `nitro-cli build-enclave`) needs ~3.5GB RSS and Docker pull uses buffer cache. With 8GB hugepages reserved, only ~5.2GB remains for host operations. Result: **OOM killer terminates Linuxkit** (`dmesg` confirmed: `linuxkit invoked oom-killer`, `Killed process ... (linuxkit) total-vm:7053816kB, anon-rss:3594464kB`).

**Root cause of intermittent failure**: The old script did `docker image prune -af` AFTER the allocator restart. But the allocator needs clean, defragmented memory. The correct order is: prune Docker → `drop_caches` → `compact_memory` → THEN restart allocator.

**Fix (tested on prod via SSM — full sequence verified):**
1. Teardown: stop services, terminate enclave, kill stale socat, wipe Docker
2. Reduce allocator to 512MB (free host RAM for build)
3. Pull image + build EIF (plenty of host RAM)
4. **Docker prune + `drop_caches` + `compact_memory`** (critical: clean up BEFORE allocation)
5. Re-increase allocator to 8192MB with retry logic (2 attempts) + verification
6. Start enclave

**SSM test results (2026-02-20):**
- Allocator at 8192MB during build: OOM kills Linuxkit (FAILED)
- Reduce → build → allocate WITHOUT cleanup: allocator only gets 3499/4096 pages (FAILED)
- Reduce → build → prune + drop_caches + compact → allocate: ALLOCATOR-SUCCESS, 8388608 kB Hugetlb (PASSED)

**Why the old approach failed intermittently**: Hugepage allocation depends on contiguous physical memory. After `drop_caches + compact_memory`, the kernel can defragment enough for 4096 × 2MB pages. Without cleanup, Docker layers and Linuxkit artifacts scatter allocations across physical pages, and the allocator rolls back ("Memory configuration failed, rolling back memory reservations").

**Additional findings:**
- Stale `socat` processes can survive `systemctl stop tee-rex-proxy` — added `pkill -f "socat.*TCP-LISTEN:4000"` to teardown to prevent false-positive health checks.
- `/tmp` is a **tmpfs** on Amazon Linux 2023 (~7.7GB, RAM-backed). Linuxkit leaves large temp files there. Using `/tmp` for `NITRO_CLI_ARTIFACTS` causes "no space left on device" on repeated deploys. Fix: use disk-backed `${EIF_DIR}/build-artifacts` instead.

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
| 12 | Deploy debug EIF (server output to /dev/console) | Console capture fails — wrong enclave name |
| 13 | Fix console capture with --enclave-id, trigger /prove | Found both root causes: X-Forwarded-For crash + CRS download failure |
| 14 | Fix: `trust proxy` = 1, pre-cache CRS in Dockerfile.nitro | Tests pass locally |
| 15 | Build + push fixed image to ECR, deploy to production | /prove works end-to-end! |

---

## Current State (2026-02-19) — ALL ISSUES RESOLVED

All root causes identified and fixed:

| Issue | Fix | File |
|---|---|---|
| Console buffer deadlock | Redirect server/socat to `/dev/null` | `Dockerfile.nitro` |
| NSM dlopen FD leak | Cache library handle globally | `attestation-service.ts` |
| X-Forwarded-For crash | `app.set("trust proxy", 1)` | `index.ts` |
| CRS download fails (no internet) | Pre-cache CRS during Docker build | `Dockerfile.nitro` |
| Allocator ordering | Reduce before build, increase after | `ci-deploy.sh` |
| Boot persistence | systemd services for enclave + proxy | `tee-rex-enclave.service`, `tee-rex-proxy.service` |

---

## Infrastructure Reference

- **TEE EC2**: i-0c1978dfd847c8440 (m5.xlarge, eu-west-2)
- **Prover EC2**: i-0817359c8affee06d (t3.xlarge, eu-west-2)
- **ECR**: 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex
- **CloudFront**: E1OVWK00AFOXHK (d3d1wk4leq65j7.cloudfront.net)
- **Allocator config**: /etc/nitro_enclaves/allocator.yaml
- **Enclave env**: /etc/tee-rex/enclave.env
- **EIF path**: /opt/tee-rex/tee-rex.eif
