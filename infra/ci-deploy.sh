#!/usr/bin/env bash
# ci-deploy.sh — Deploy tee-rex enclave from a fresh Docker image.
# Intended to be executed via AWS SSM on the CI/prod EC2 instance.
#
# Usage: ci-deploy.sh <ecr-image-uri>
# Example: ci-deploy.sh <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:nightly
#
# The enclave survives reboots via two systemd services:
#   tee-rex-enclave.service — runs the enclave from a persisted EIF
#   tee-rex-proxy.service   — socat proxy (TCP:4000 → vsock enclave)
# The EIF is stored in /opt/tee-rex/ (not /tmp) so it persists across reboots.

set -euo pipefail

IMAGE_URI="${1:?Usage: ci-deploy.sh <ecr-image-uri>}"
REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
EIF_DIR="/opt/tee-rex"
EIF_PATH="${EIF_DIR}/tee-rex.eif"
BUILD_ARTIFACTS="${EIF_DIR}/build-artifacts"
CPU_COUNT=2
MEMORY_MB=8192
ENCLAVE_CID=16

echo "=== TEE-Rex CI Deploy ==="
echo "Image: ${IMAGE_URI}"
echo "Region: ${REGION}"

# ── 0. Tear down existing enclave + proxy + reclaim disk ──────────
# Must happen before disk check. nitro-cli build-enclave creates overlay2
# layers that Docker's metadata doesn't track, so `docker system prune`
# can't remove them. Wipe all of /var/lib/docker so Docker reinitializes
# cleanly — partial wipes (overlay2 only) corrupt Docker's internal state.
echo "=== Tearing down existing enclave ==="
systemctl stop tee-rex-proxy 2>/dev/null || true
systemctl stop tee-rex-enclave 2>/dev/null || true
nitro-cli terminate-enclave --all 2>/dev/null || true
# Kill any stale socat processes that might survive service stop
pkill -f "socat.*TCP-LISTEN:4000" 2>/dev/null || true
rm -f "${EIF_PATH}"
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
# Linuxkit leaves large temp files in /tmp (which is tmpfs on Amazon Linux 2023,
# ~7.7GB backed by RAM). Clean them to prevent "no space left on device" on tmpfs.
find /tmp -maxdepth 1 -type f -size +10M -delete 2>/dev/null || true
systemctl stop docker 2>/dev/null || true
rm -rf /var/lib/docker/*
systemctl start docker
journalctl --vacuum-size=50M 2>/dev/null || true

# Reduce hugepages for the build phase — Linuxkit (used by nitro-cli build-enclave)
# needs ~3.5GB RSS and Docker pull uses buffer cache. With 8GB hugepages reserved,
# only ~5.2GB remains for host operations, causing OOM kills on Linuxkit.
# We reduce to 512MB here, build the EIF, then re-allocate after cleanup.
echo "=== Reducing hugepages for build phase ==="
sed -i "s/memory_mib: .*/memory_mib: 512/" /etc/nitro_enclaves/allocator.yaml
systemctl restart nitro-enclaves-allocator.service || true
sleep 2

# ── 1. Disk space check ──────────────────────────────────────────
AVAIL_MB=$(df -BM / | tail -1 | awk '{print $4}' | tr -d 'M')
echo "Disk space available: ${AVAIL_MB}MB"
if [[ "${AVAIL_MB}" -lt 4096 ]]; then
  echo "ERROR: Insufficient disk space (${AVAIL_MB}MB < 4096MB required)"
  echo "Consider increasing EBS volume size"
  exit 1
fi

# ── 2. Pull Docker image (reuses cached layers from previous deploy)
echo "=== Pulling image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${IMAGE_URI%%/*}"
docker pull "${IMAGE_URI}"

# ── 3. Build EIF ──────────────────────────────────────────────────
# Must happen before prune: nitro-cli reads the Docker image directly,
# so the image must still be on disk.
# Store EIF in /opt/tee-rex/ so it survives reboots (unlike /tmp).
# Use disk-backed artifacts dir — /tmp is tmpfs on Amazon Linux 2023 (~7.7GB RAM).
# Linuxkit's initrd + Docker temp files can exceed tmpfs capacity.
echo "=== Building EIF ==="
mkdir -p "${EIF_DIR}" "${BUILD_ARTIFACTS}"
NITRO_CLI_ARTIFACTS="${BUILD_ARTIFACTS}" nitro-cli build-enclave \
  --docker-uri "${IMAGE_URI}" \
  --output-file "${EIF_PATH}"

# ── 4. Clean up + reserve hugepages ──────────────────────────────
# Docker prune + drop_caches + compact_memory BEFORE allocator restart.
# This is critical: Linuxkit fragments host memory during EIF build. Without
# cleanup, the allocator can't find contiguous 2MB pages for hugepages.
echo "=== Cleaning up before hugepage allocation ==="
docker image prune -af
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
sync && echo 3 > /proc/sys/vm/drop_caches
echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
sleep 2
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

echo "=== Reserving hugepages (${MEMORY_MB}MB) ==="
sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
sed -i "s/cpu_count: .*/cpu_count: ${CPU_COUNT}/" /etc/nitro_enclaves/allocator.yaml

ALLOC_OK=false
for attempt in 1 2; do
  if systemctl restart nitro-enclaves-allocator.service; then
    sleep 3
    HUGE_TOTAL=$(grep HugePages_Total /proc/meminfo | awk '{print $2}')
    HUGE_FREE=$(grep HugePages_Free /proc/meminfo | awk '{print $2}')
    echo "Hugepages: total=${HUGE_TOTAL} free=${HUGE_FREE} (attempt ${attempt})"
    if [[ "${HUGE_TOTAL}" -gt 0 ]]; then
      ALLOC_OK=true
      break
    fi
    echo "WARNING: Allocator restarted but no hugepages reserved, retrying..."
  else
    echo "WARNING: Allocator restart failed (attempt ${attempt})"
  fi
  sync && echo 3 > /proc/sys/vm/drop_caches
  echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
  sleep 5
done

if [[ "${ALLOC_OK}" != "true" ]]; then
  echo "ERROR: Failed to reserve hugepages after 2 attempts"
  grep Huge /proc/meminfo
  free -m
  exit 1
fi

# ── 5. Install systemd services + config ──────────────────────────
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

# ── 6. Start enclave + proxy ─────────────────────────────────────
echo "=== Starting enclave ==="
systemctl start tee-rex-enclave
echo "=== Starting proxy ==="
systemctl restart tee-rex-proxy

# ── 7. Health check ─────────────────────────────────────────────
echo "=== Health check ==="
for i in $(seq 1 120); do
  if RESPONSE=$(curl -sf http://localhost:4000/attestation 2>/dev/null) && \
     echo "${RESPONSE}" | jq -e '.mode' > /dev/null 2>&1; then
    echo "Enclave healthy (attempt ${i})"
    echo "${RESPONSE}" | jq '{mode, hasDoc: (.attestationDocument != null)}'
    echo "=== Deploy complete ==="
    exit 0
  fi
  sleep 5
done

echo "ERROR: Health check failed after 10 minutes"
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
