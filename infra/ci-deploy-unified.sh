#!/usr/bin/env bash
# ci-deploy-unified.sh — Deploy tee-rex enclave + prover on a single instance.
# Intended to be executed via AWS SSM on the EC2 instance.
#
# Usage: ci-deploy-unified.sh <nitro-image-uri> <prover-image-uri>
# Example: ci-deploy-unified.sh \
#   <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:prod-tee \
#   <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:prod-prover
#
# Runs the enclave on port 4000 (via socat proxy) and the prover Docker
# container on port 80. Both services survive reboots (systemd + --restart).

set -euo pipefail

NITRO_IMAGE_URI="${1:?Usage: ci-deploy-unified.sh <nitro-image-uri> <prover-image-uri>}"
PROVER_IMAGE_URI="${2:?Usage: ci-deploy-unified.sh <nitro-image-uri> <prover-image-uri>}"
REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
EIF_DIR="/opt/tee-rex"
EIF_PATH="${EIF_DIR}/tee-rex.eif"
BUILD_ARTIFACTS="${EIF_DIR}/build-artifacts"
CPU_COUNT=46
MEMORY_MB=88064
ENCLAVE_CID=16
PROVER_CONTAINER_NAME="tee-rex-prover"

echo "=== TEE-Rex Unified CI Deploy ==="
echo "Nitro image: ${NITRO_IMAGE_URI}"
echo "Prover image: ${PROVER_IMAGE_URI}"
echo "Region: ${REGION}"

# ── 0. Tear down existing enclave + proxy + prover + reclaim disk ──
# Must happen before disk check. nitro-cli build-enclave creates overlay2
# layers that Docker's metadata doesn't track, so `docker system prune`
# can't remove them. Wipe all of /var/lib/docker so Docker reinitializes
# cleanly — partial wipes (overlay2 only) corrupt Docker's internal state.
echo "=== Tearing down existing services ==="
systemctl stop tee-rex-proxy 2>/dev/null || true
systemctl stop tee-rex-enclave 2>/dev/null || true
nitro-cli terminate-enclave --all 2>/dev/null || true
# Kill any stale socat processes that might survive service stop
pkill -f "socat.*TCP-LISTEN:4000" 2>/dev/null || true
# Stop prover container (if running from previous deploy)
docker stop "${PROVER_CONTAINER_NAME}" 2>/dev/null || true
docker rm "${PROVER_CONTAINER_NAME}" 2>/dev/null || true
rm -f "${EIF_PATH}"
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
# Linuxkit leaves large temp files in /tmp (which is tmpfs on Amazon Linux 2023,
# ~7.7GB backed by RAM). Clean them to prevent "no space left on device" on tmpfs.
find /tmp -maxdepth 1 -type f -size +10M -delete 2>/dev/null || true
systemctl stop docker 2>/dev/null || true
rm -rf /var/lib/docker/*
systemctl start docker
journalctl --vacuum-size=50M 2>/dev/null || true

# Allocate hugepages to target IMMEDIATELY, before any Docker/Linuxkit activity.
# On clean memory (right after teardown), the allocator can find contiguous 2MB
# pages. Doing this AFTER the EIF build fails on large instances (c7i.12xlarge)
# because Linuxkit fragments memory beyond recovery — even with drop_caches +
# compact_memory, the allocator only reclaims ~15GB of hugepages on a 96GB host.
# With 88GB hugepages pre-allocated, ~8GB remains for the host — enough for
# Linuxkit (~3.5GB RSS) since NITRO_CLI_ARTIFACTS uses disk-backed storage.
echo "=== Allocating hugepages (${MEMORY_MB}MB) ==="
sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
sed -i "s/cpu_count: .*/cpu_count: ${CPU_COUNT}/" /etc/nitro_enclaves/allocator.yaml

ALLOC_OK=false
for attempt in 1 2; do
  if systemctl restart nitro-enclaves-allocator.service; then
    sleep 5
    HUGE_TOTAL=$(grep HugePages_Total /proc/meminfo | awk '{print $2}')
    HUGE_FREE=$(grep HugePages_Free /proc/meminfo | awk '{print $2}')
    EXPECTED_PAGES=$((MEMORY_MB / 2))
    echo "Hugepages: total=${HUGE_TOTAL} expected=${EXPECTED_PAGES} free=${HUGE_FREE} (attempt ${attempt})"
    if [[ "${HUGE_TOTAL}" -ge "${EXPECTED_PAGES}" ]]; then
      ALLOC_OK=true
      break
    fi
    echo "WARNING: Insufficient hugepages (got ${HUGE_TOTAL}, need ${EXPECTED_PAGES}), retrying..."
  else
    echo "WARNING: Allocator restart failed (attempt ${attempt})"
  fi
  sync && echo 3 > /proc/sys/vm/drop_caches
  echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
  sleep 5
done

if [[ "${ALLOC_OK}" != "true" ]]; then
  echo "ERROR: Failed to allocate ${MEMORY_MB}MB hugepages"
  grep Huge /proc/meminfo
  free -m
  exit 1
fi
echo "Host memory after hugepage allocation:"
free -m

# ── 1. Disk space check ──────────────────────────────────────────
AVAIL_MB=$(df -BM / | tail -1 | awk '{print $4}' | tr -d 'M')
echo "Disk space available: ${AVAIL_MB}MB"
if [[ "${AVAIL_MB}" -lt 4096 ]]; then
  echo "ERROR: Insufficient disk space (${AVAIL_MB}MB < 4096MB required)"
  echo "Consider increasing EBS volume size"
  exit 1
fi

# ── 2. ECR login + pull nitro image ──────────────────────────────
echo "=== Pulling nitro image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${NITRO_IMAGE_URI%%/*}"
docker pull "${NITRO_IMAGE_URI}"

# ── 3. Build EIF ─────────────────────────────────────────────────
# Must happen before prune: nitro-cli reads the Docker image directly,
# so the image must still be on disk.
# Store EIF in /opt/tee-rex/ so it survives reboots (unlike /tmp).
# Use disk-backed artifacts dir — /tmp is tmpfs on Amazon Linux 2023 (~7.7GB RAM).
# Linuxkit's initrd + Docker temp files can exceed tmpfs capacity.
echo "=== Building EIF ==="
mkdir -p "${EIF_DIR}" "${BUILD_ARTIFACTS}"
NITRO_CLI_ARTIFACTS="${BUILD_ARTIFACTS}" nitro-cli build-enclave \
  --docker-uri "${NITRO_IMAGE_URI}" \
  --output-file "${EIF_PATH}"

# ── 4. Clean up build artifacts ──────────────────────────────────
# Hugepages were already allocated before the build (step 0b), so no
# re-allocation needed. Just clean up Docker images and temp files.
echo "=== Cleaning up build artifacts ==="
docker image prune -af
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

# ── 5. Install systemd services + config ─────────────────────────
# Two services make the enclave survive reboots:
#   tee-rex-enclave — runs the enclave from the persisted EIF
#   tee-rex-proxy   — socat proxy (TCP:4000 → vsock enclave)
echo "=== Installing systemd services ==="
mkdir -p /etc/tee-rex
cat > /etc/tee-rex/enclave.env <<EOF
CPU_COUNT=${CPU_COUNT}
MEMORY_MB=${MEMORY_MB}
ENCLAVE_CID=${ENCLAVE_CID}
EOF

cat > /etc/systemd/system/tee-rex-enclave.service <<'UNIT'
[Unit]
Description=tee-rex Nitro Enclave
After=nitro-enclaves-allocator.service
Requires=nitro-enclaves-allocator.service
ConditionPathExists=/opt/tee-rex/tee-rex.eif

[Service]
Type=oneshot
RemainAfterExit=yes
EnvironmentFile=/etc/tee-rex/enclave.env
ExecStart=/usr/bin/nitro-cli run-enclave --eif-path /opt/tee-rex/tee-rex.eif --cpu-count ${CPU_COUNT} --memory ${MEMORY_MB} --enclave-cid ${ENCLAVE_CID}
ExecStop=/usr/bin/nitro-cli terminate-enclave --all

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/tee-rex-proxy.service <<'UNIT'
[Unit]
Description=tee-rex socat proxy (TCP:4000 → vsock enclave)
After=tee-rex-enclave.service
Requires=tee-rex-enclave.service

[Service]
EnvironmentFile=/etc/tee-rex/enclave.env
ExecStart=/usr/bin/socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:${ENCLAVE_CID}:5000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable tee-rex-enclave tee-rex-proxy

# ── 6. Start enclave + proxy ────────────────────────────────────
echo "=== Starting enclave ==="
systemctl start tee-rex-enclave
echo "=== Starting proxy ==="
systemctl restart tee-rex-proxy

# ── 7. Enclave health check ─────────────────────────────────────
echo "=== Enclave health check ==="
for i in $(seq 1 120); do
  if RESPONSE=$(curl -sf http://localhost:4000/attestation 2>/dev/null) && \
     echo "${RESPONSE}" | jq -e '.mode' > /dev/null 2>&1; then
    echo "Enclave healthy (attempt ${i})"
    echo "${RESPONSE}" | jq '{mode, hasDoc: (.attestationDocument != null)}'
    break
  fi
  if [[ "${i}" -eq 120 ]]; then
    echo "ERROR: Enclave health check failed after 10 minutes"
    echo "=== Diagnostics ==="
    echo "--- Enclave status ---"
    nitro-cli describe-enclaves 2>/dev/null || echo "nitro-cli not available"
    echo "--- Service status ---"
    systemctl status tee-rex-enclave --no-pager -l 2>/dev/null || true
    systemctl status tee-rex-proxy --no-pager -l 2>/dev/null || true
    echo "--- Hugepages ---"
    grep Huge /proc/meminfo
    echo "--- Memory ---"
    free -m
    echo "--- Disk ---"
    df -h /
    exit 1
  fi
  sleep 5
done

# ── 8. Pull + run prover container ──────────────────────────────
# Deployed AFTER enclave is healthy — Docker wipe in step 0 would kill
# a pre-existing prover container, and we need Docker available for pull.
echo "=== Deploying prover container ==="
echo "Pulling prover image: ${PROVER_IMAGE_URI}"
# ECR login already done in step 2 (same registry)
docker pull "${PROVER_IMAGE_URI}"

echo "=== Starting prover container ==="
docker run -d \
  --name "${PROVER_CONTAINER_NAME}" \
  -p 80:80 \
  -e NODE_ENV=production \
  --restart unless-stopped \
  "${PROVER_IMAGE_URI}"

# Clean up unused images (prover pull may have brought new layers)
docker image prune -af

# ── 9. Prover health check ──────────────────────────────────────
echo "=== Prover health check ==="
for i in $(seq 1 120); do
  if RESPONSE=$(curl -sf http://localhost:80/attestation 2>/dev/null) && \
     echo "${RESPONSE}" | jq -e '.mode' > /dev/null 2>&1; then
    echo "Prover healthy (attempt ${i})"
    echo "${RESPONSE}" | jq '{mode}'
    break
  fi
  if [[ "${i}" -eq 120 ]]; then
    echo "ERROR: Prover health check failed after 10 minutes"
    echo "--- Container status ---"
    docker ps -a --filter "name=${PROVER_CONTAINER_NAME}" 2>/dev/null || true
    echo "--- Container logs ---"
    docker logs "${PROVER_CONTAINER_NAME}" --tail 30 2>/dev/null || true
    echo "--- Memory ---"
    free -m
    exit 1
  fi
  sleep 5
done

echo "=== Unified deploy complete ==="
echo "Enclave: port 4000 (nitro)"
echo "Prover:  port 80   (standard)"
