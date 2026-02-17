# Infrastructure & Docker Audit

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: All Dockerfiles, deploy scripts, IAM policies, CloudFront config, infra docs  

## Summary

The infrastructure is well-designed: OIDC auth (no stored keys), tag-based EC2 scoping, SSM over SSH, and an efficient Docker layer caching strategy. Key concerns: CloudFront origin timeout of 60s is too short for proving (requests take 1-5 minutes), all containers run as root, deploy scripts don't check disk space, socat proxy is a fragile background process (not systemd), and the IAM policy grants unrestricted `s3:DeleteObject` on prod buckets.

## Findings

### Critical

#### C1. CloudFront origin timeout (60s) too short for proving
- **File**: `infra/cloudfront/distribution.json:24,35`
- **Issue**: `OriginReadTimeout` defaults to 60 seconds. Proof generation takes 1-5 minutes. Requests timing out get 504 "Gateway Timeout" even though the server is still working.
- **Impact**: Users see "proof failed" errors for normal operations. This is a user-facing production bug.
- **Category**: Configuration
- **Fix**: Request AWS quota increase for Origin Read Timeout to 180 seconds (max allowed). Alternatively, implement long-polling or WebSocket for proof status.
- **Effort**: Small (AWS support ticket) or Medium (architecture change)

### High

#### H1. All containers run as root
- **Files**: `Dockerfile`, `Dockerfile.base`, `Dockerfile.nitro`
- **Issue**: No `USER` directive in any Dockerfile. All processes (Express server, Bun runtime, socat) run as root inside the container.
- **Impact**: If an attacker exploits the Express server, they get root access inside the container. Combined with EC2 metadata service access, this could lead to privilege escalation.
- **Category**: Security
- **Fix**: Add `RUN useradd -m -u 1000 app && chown -R app:app /app` to Dockerfile.base, then `USER app` before CMD. Note: Dockerfile.nitro's entrypoint needs root for `ifconfig lo`, so use `gosu` or split into setup (root) + run (non-root) stages.
- **Effort**: Medium

#### H2. IAM policy grants unrestricted `s3:DeleteObject` on prod
- **File**: `infra/iam/tee-rex-ci-policy.json:95-107`
- **Issue**: CI role can `s3:PutObject` and `s3:DeleteObject` on `tee-rex-app-prod*` without conditions. A compromised CI token or misconfigured workflow could delete the entire production app.
- **Impact**: Production outage — users see blank page until redeploy.
- **Category**: Security
- **Fix**: Add condition requiring specific source (e.g., `aws:CalledVia: ["cloudfront.amazonaws.com"]`) or scope to deployment-time only via a separate role.
- **Effort**: Medium

#### H3. Deploy scripts don't check disk space
- **Files**: `infra/ci-deploy.sh`, `infra/ci-deploy-prover.sh`
- **Issue**: Neither script validates EBS volume has sufficient space before pulling Docker images (~2GB) or building EIF (~1.5GB). If disk is full, operations fail silently and the 10-minute health check timeout runs to completion before reporting failure.
- **Impact**: Wasted CI time (10+ minutes) and confusing error messages.
- **Category**: Robustness
- **Fix**: Add at script start: `AVAIL_MB=$(df / | tail -1 | awk '{print $4}'); if [ "$AVAIL_MB" -lt 3072 ]; then echo "ERROR: <3GB free"; exit 1; fi`
- **Effort**: Trivial

### Medium

#### M1. socat proxy is a fragile background process
- **File**: `infra/ci-deploy.sh:69-71`
- **Code**: `setsid socat ... > /dev/null 2>&1 & ; disown`
- **Issue**: socat runs as an orphaned background process. If EC2 instance reboots, socat doesn't restart. If socat crashes, no monitoring detects it.
- **Impact**: TEE becomes unreachable after reboot until next deploy.
- **Category**: Reliability
- **Fix**: Create a systemd service for socat, or at minimum add it to crontab with `@reboot`.
- **Effort**: Small

#### M2. CID extraction from nitro-cli has no error handling
- **File**: `infra/ci-deploy.sh:64`
- **Code**: `CID=$(echo "${ENCLAVE_OUT}" | jq -r '.EnclaveCID // 16')`
- **Issue**: If `jq` fails (malformed JSON from nitro-cli), `CID` becomes empty and socat fails with "invalid CID".
- **Category**: Error Handling
- **Fix**: Add check: `if [ -z "$CID" ] || [ "$CID" = "null" ]; then echo "ERROR: Failed to extract CID"; exit 1; fi`
- **Effort**: Trivial

#### M3. NSM API version hardcoded without integrity check
- **File**: `Dockerfile.nitro:11`
- **Code**: `ENV AWS_NE_NSM_API_VER="v0.4.0"` + `git clone --depth 1 -b ${AWS_NE_NSM_API_VER}`
- **Issue**: Git clone without commit hash verification or GPG signature check. Susceptible to MITM or tag mutation.
- **Category**: Supply Chain Security
- **Fix**: Pin to specific commit SHA instead of tag. Or verify the git tag signature after clone.
- **Effort**: Small

#### M4. No monitoring or alerting on EC2 instances
- **Issue**: No CloudWatch alarms configured for: CPU/memory utilization, EBS capacity, HTTP error rates, SSM command failures, or container health.
- **Impact**: Silent failures go undetected until users report issues.
- **Category**: Observability
- **Fix**: Add basic CloudWatch alarms: CPU >90% for 5 min, EBS >80% capacity, unhealthy Docker containers.
- **Effort**: Medium

#### M5. No Docker log rotation configured
- **Issue**: Docker daemon uses default logging (json-file, no max size). Proof errors generate verbose logs that can fill EBS.
- **Category**: Reliability
- **Fix**: Configure Docker daemon: `{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }` via `/etc/docker/daemon.json`.
- **Effort**: Small

#### M6. Health checks only validate endpoint existence
- **Files**: `infra/ci-deploy.sh`, `infra/ci-deploy-prover.sh`
- **Issue**: Health check `curl -sf http://localhost:PORT/attestation` only checks HTTP 200. Doesn't validate response body (e.g., `mode: "nitro"` for TEE, valid publicKey).
- **Category**: Robustness
- **Fix**: Add body validation: `curl -sf ... | jq -e '.mode == "nitro" and .attestationDocument != null'` for TEE.
- **Effort**: Small

### Low

#### L1. `iproute2` and `net-tools` both installed in Dockerfile.nitro
- **File**: `Dockerfile.nitro:35`
- **Issue**: Both packages provide overlapping networking utilities. `net-tools` (ifconfig) only needed for the `ifconfig lo` workaround in entrypoint.
- **Category**: Image Size
- **Fix**: Replace `ifconfig lo 127.0.0.1` with `ip addr add 127.0.0.1/8 dev lo && ip link set lo up` and remove `net-tools`.
- **Effort**: Trivial

#### L2. Dockerfile.nitro intermediate builder stage may be unnecessary
- **File**: `Dockerfile.nitro` (stage 2: builder)
- **Issue**: builder stage just copies source + creates symlinks. Could be done directly in the runtime stage.
- **Category**: Build Efficiency
- **Fix**: Merge builder stage into runtime stage (saves one FROM layer).
- **Effort**: Small

#### L3. OpenTofu example is unused
- **File**: `infra/opentofu-example/`
- **Issue**: Research artifact from Phase 21. Not connected to CI or actual infrastructure.
- **Category**: Code Hygiene
- **Fix**: Acceptable as reference material. Document its status in infra/README.md.
- **Effort**: N/A

## Positive Notes

- OIDC-based auth — no long-lived AWS keys
- Tag-based EC2 scoping in IAM (Environment: ci/prod/devnet)
- SSM over SSH — no public ports on EC2
- Efficient Docker layer caching strategy (base image in ECR)
- Idempotent deploy scripts (safe to re-run)
- EBS volumes sized at 20GB (Phase 20A — up from 8GB)
- CloudFront Function for path prefix stripping (elegant)
- OAC for S3 origin (not deprecated OAI)
- journalctl vacuum in deploy scripts (log cleanup)
