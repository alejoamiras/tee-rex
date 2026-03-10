# TEE Performance Optimization

## Context

TEE proving on remote server was not significantly faster than local macOS laptop despite 100-vCPU devnet machine. Root causes:

1. **Enclave CPU starvation**: `CPU_COUNT=2` hardcoded — enclave only got 2 vCPUs regardless of host size
2. **bb thread cap**: Barretenberg caps at `min(32, hardware_concurrency)`, `HARDWARE_CONCURRENCY` env var never set
3. **Instance too small**: Prod used `m5.xlarge` (4 vCPU, 16GB RAM)

## Changes Made

| Change | File | Details |
|--------|------|---------|
| Bump prod instance | `infra/tofu/ec2.tf` | `m5.xlarge` (4 vCPU, 16GB) -> `c7i.12xlarge` (48 vCPU, 96GB) |
| Auto-detect CPU/memory | `infra/ci-deploy-unified.sh` | `nproc - 2` vCPUs, `MemTotal - 16GB` for enclave; min 2 vCPU / 8GB |
| 1GB hugepage support | `infra/ci-deploy-unified.sh` | c7i has 4096 memory-region limit; 1GB pages stay under limit |
| Set HARDWARE_CONCURRENCY | `Dockerfile.nitro` | `export HARDWARE_CONCURRENCY=$(nproc)` before server start |
| Set HARDWARE_CONCURRENCY | `infra/ci-deploy-unified.sh` | Passed to prover container via `-e HARDWARE_CONCURRENCY` |
| ~~Bump CloudFront timeout~~ | `infra/tofu/cloudfront.tf` | **REVERTED** — 180s exceeds account's approved limit (max 120s). Needs AWS support ticket. |

## Expected Configuration

| Instance | vCPUs (enclave) | Memory (enclave) | Hugepage strategy |
|----------|----------------|------------------|-------------------|
| c7i.12xlarge (prod) | 46 | ~80GB | 1GB pages (pre-allocated) |
| m5.xlarge (CI) | 2 | ~8GB | 2MB pages (deferred, post-build) |

## Proof Time Results

<!-- Fill in after deployment -->

| Scenario | Before (m5.xlarge) | After (c7i.12xlarge) |
|----------|-------------------|---------------------|
| Remote prove | TBD | TBD |
| TEE prove | TBD | TBD |

## Deployment Attempts

### Attempt 1 (2026-03-10): tofu apply — FAILED

| Issue | Details |
|-------|---------|
| **vCPU limit** | On-demand standard limit = 64 vCPUs. Devnet c7i.12xlarge (48) + prod c7i.12xlarge (48) = 96, exceeds limit. Tofu stopped prod, resized to c7i.12xlarge, but failed to start. |
| **CloudFront timeout** | 180s `origin_read_timeout` rejected — account limit is 120s. Needs AWS support ticket for higher. |
| **Recovery** | Reverted prod to m5.xlarge via `tofu apply`. Prod restored and running. |
| **Pending** | vCPU quota increase request for 200 vCPUs (opened 2026-03-02, status: CASE_OPENED). Once approved, can retry. |

### Attempt 2 (2026-03-10): Swap devnet ↔ prod — SUCCESS

Workaround for 64 vCPU limit: downsize devnet to m5.xlarge (4 vCPU), upsize prod to c7i.12xlarge (48 vCPU). Total = 52 vCPUs, under 64 limit.

| Step | Result |
|------|--------|
| `tofu apply` (swap instance types) | Success — both instances resized in-place |
| Deploy #171 (PR merge → deploy-prod.yml) | **Failed** — enclave CPU pool error E22 (`Insufficient CPUs available in the pool`) |
| Root cause | Two issues: (1) `nproc` returns 46 not 48 because old allocator reserved 2 CPUs — fixed with `nproc --all`. (2) Allocator never restarted after config update in 1GB hugepage path — CPU pool stayed at 2. |
| Fix PR #172 | Added `systemctl restart nitro-enclaves-allocator.service` + `sleep 3` after updating allocator.yaml, before EIF build |
| Deploy #172 | **Success** — enclave healthy (nitro mode, attestation doc), prover healthy (standard mode) |
| E2E validation | Timed out at 30min — nextnet not confirming blocks (unrelated to deploy) |

### Lessons Learned

- Instance type change is **in-place** (stop → resize → start), NOT destroy+recreate. Instance ID stays the same.
- Devnet instance was already c7i.12xlarge in AWS but code on main said m5.xlarge — fixed code to match.
- CloudFront `origin_read_timeout` max is 60s by default, 120s with quota increase. Account has 120s. 180s needs another support request.
- Always check `aws service-quotas get-service-quota` before resizing.
- **`nproc` vs `nproc --all`**: After the nitro-enclaves-allocator reserves CPUs, `nproc` excludes them. Use `nproc --all` to get the true host CPU count for resource calculations.
- **Allocator restart is mandatory**: After updating `/etc/nitro_enclaves/allocator.yaml`, you MUST `systemctl restart nitro-enclaves-allocator.service` before `nitro-cli run-enclave`. Otherwise the CPU pool stays stale and you get E22 errors.
- **vCPU quota workaround**: When quota limits block having two large instances, temporarily downsize the less-important environment.

## Deployment Notes

- Instance type change is in-place (stop/resize/start) — instance ID preserved
- EIP stays associated
- Requires `tofu apply` then deploy workflow
- Cost: ~$1.50/hr (c7i.12xlarge) vs ~$0.19/hr (m5.xlarge) — intentional for benchmarking
- **Resolved**: Prod running on c7i.12xlarge, devnet on m5.xlarge. vCPU quota increase still pending (will allow both to be large).
