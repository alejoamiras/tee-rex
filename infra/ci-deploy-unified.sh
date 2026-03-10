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
ENCLAVE_CID=16
PROVER_CONTAINER_NAME="tee-rex-prover"

# Auto-detect host resources, reserve minimum for host OS + prover container
TOTAL_VCPUS=$(nproc)
TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
CPU_COUNT=$(( TOTAL_VCPUS - 2 ))           # Reserve 2 vCPUs for host
MEMORY_MB=$(( TOTAL_MEM_MB - 16384 ))      # Reserve 16GB for host

# Minimum viable enclave: 2 vCPUs, 8GB
if [[ "${CPU_COUNT}" -lt 2 ]]; then CPU_COUNT=2; fi
if [[ "${MEMORY_MB}" -lt 8192 ]]; then MEMORY_MB=8192; fi

echo "=== TEE-Rex Unified CI Deploy ==="
echo "Nitro image: ${NITRO_IMAGE_URI}"
echo "Prover image: ${PROVER_IMAGE_URI}"
echo "Region: ${REGION}"
echo "Host: ${TOTAL_VCPUS} vCPUs, ${TOTAL_MEM_MB}MB RAM"
echo "Enclave: ${CPU_COUNT} vCPUs, ${MEMORY_MB}MB RAM"

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

# ── 1. Pre-allocate hugepages ─────────────────────────────────────
# c7i (Sapphire Rapids) has a 4096 memory-region limit for Nitro Enclaves.
# 80GB of 2MB pages = 40,960 regions — way over the limit. Use 1GB pages
# when available (73 pages for ~73GB), staying well under 4096 total.
# On older instances (m5) without 1GB hugepage support, use 2MB pages only.
#
# Hugepages MUST be allocated BEFORE the EIF build — on large instances,
# post-build memory fragmentation prevents allocation of 1GB pages entirely.
echo "=== Pre-allocating hugepages (${MEMORY_MB}MB for ${CPU_COUNT} vCPUs) ==="

# Clean memory before allocation
sync && echo 3 > /proc/sys/vm/drop_caches
echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
sleep 2

HUGEPAGE_1G_DIR="/sys/kernel/mm/hugepages/hugepages-1048576kB"
HUGEPAGE_2M_DIR="/sys/kernel/mm/hugepages/hugepages-2048kB"

if [[ -d "${HUGEPAGE_1G_DIR}" ]]; then
  # 1GB hugepage strategy (c7i/Sapphire Rapids)
  PAGES_1G=$(( MEMORY_MB / 1024 ))
  REMAINDER_MB=$(( MEMORY_MB - PAGES_1G * 1024 ))
  PAGES_2M=0
  if [[ "${REMAINDER_MB}" -gt 0 ]]; then
    PAGES_2M=$(( REMAINDER_MB / 2 ))
  fi

  echo "Allocating ${PAGES_1G} x 1GB pages + ${PAGES_2M} x 2MB pages"
  echo "${PAGES_1G}" > "${HUGEPAGE_1G_DIR}/nr_hugepages"
  sleep 2
  ACTUAL_1G=$(cat "${HUGEPAGE_1G_DIR}/nr_hugepages")
  echo "1GB hugepages allocated: ${ACTUAL_1G}/${PAGES_1G}"

  if [[ "${PAGES_2M}" -gt 0 ]]; then
    echo "${PAGES_2M}" > "${HUGEPAGE_2M_DIR}/nr_hugepages"
    sleep 1
    ACTUAL_2M=$(cat "${HUGEPAGE_2M_DIR}/nr_hugepages")
    echo "2MB hugepages allocated: ${ACTUAL_2M}/${PAGES_2M}"
  fi

  if [[ "${ACTUAL_1G}" -lt 1 ]]; then
    echo "ERROR: Failed to allocate any 1GB hugepages"
    grep Huge /proc/meminfo
    free -m
    exit 1
  fi
else
  # 2MB hugepage strategy (m5/older instances)
  # Disable allocator first so we can build EIF without memory pressure
  echo "No 1GB hugepage support — using 2MB pages (deferred until after EIF build)"
  sed -i "s/memory_mib: .*/memory_mib: 512/" /etc/nitro_enclaves/allocator.yaml
  systemctl restart nitro-enclaves-allocator.service || true
  sleep 2
  DEFER_2M_HUGEPAGES=true
fi

# Configure allocator for the enclave
sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
sed -i "s/cpu_count: .*/cpu_count: ${CPU_COUNT}/" /etc/nitro_enclaves/allocator.yaml

# ── 2. Disk space check ──────────────────────────────────────────
AVAIL_MB=$(df -BM / | tail -1 | awk '{print $4}' | tr -d 'M')
echo "Disk space available: ${AVAIL_MB}MB"
if [[ "${AVAIL_MB}" -lt 4096 ]]; then
  echo "ERROR: Insufficient disk space (${AVAIL_MB}MB < 4096MB required)"
  echo "Consider increasing EBS volume size"
  exit 1
fi

# ── 3. ECR login + pull nitro image ──────────────────────────────
echo "=== Pulling nitro image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${NITRO_IMAGE_URI%%/*}"
docker pull "${NITRO_IMAGE_URI}"

# ── 4. Build EIF ─────────────────────────────────────────────────
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

# ── 5. Clean up + allocate 2MB hugepages (deferred path only) ────
echo "=== Cleaning up after EIF build ==="
docker image prune -af
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
sync && echo 3 > /proc/sys/vm/drop_caches
echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
sleep 2
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

if [[ "${DEFER_2M_HUGEPAGES:-false}" == "true" ]]; then
  # 2MB hugepage allocation — only for instances without 1GB hugepage support.
  # Must happen after EIF build + cleanup to avoid memory fragmentation.
  echo "=== Reserving 2MB hugepages (${MEMORY_MB}MB) ==="
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
fi

# ── 6. Install systemd services + config ─────────────────────────
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

# ── 7. Start enclave + proxy ────────────────────────────────────
echo "=== Starting enclave ==="
systemctl start tee-rex-enclave
echo "=== Starting proxy ==="
systemctl restart tee-rex-proxy

# ── 8. Enclave health check ─────────────────────────────────────
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

# ── 9. Pull + run prover container ──────────────────────────────
# Deployed AFTER enclave is healthy — Docker wipe in step 0 would kill
# a pre-existing prover container, and we need Docker available for pull.
echo "=== Deploying prover container ==="
echo "Pulling prover image: ${PROVER_IMAGE_URI}"
# ECR login already done in step 3 (same registry)
docker pull "${PROVER_IMAGE_URI}"

echo "=== Starting prover container ==="
docker run -d \
  --name "${PROVER_CONTAINER_NAME}" \
  -p 80:80 \
  -e NODE_ENV=production \
  -e HARDWARE_CONCURRENCY="$(nproc)" \
  --restart unless-stopped \
  "${PROVER_IMAGE_URI}"

# Clean up unused images (prover pull may have brought new layers)
docker image prune -af

# ── 10. Prover health check ─────────────────────────────────────
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
