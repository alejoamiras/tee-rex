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

# ── 0.5. Pre-allocate 1GB hugepages while memory is unfragmented ──
# On Sapphire Rapids (c7i), the allocator uses a MIX of 1GB + 2MB hugepages.
# Nitro Enclaves have a 4096 memory-region limit per enclave. With 88064MB:
#   - 86 × 1GB = 88064MB → 86 regions (fits easily)
#   - 44032 × 2MB = 88064MB → 44032 regions (WAY over limit!)
# We MUST use 1GB pages. Allocate via sysfs before the EIF build fragments
# memory. The EIF build + Docker will run in the remaining ~10 GiB.
echo "=== Pre-allocating hugepages (before EIF build) ==="
systemctl stop nitro-enclaves-allocator.service 2>/dev/null || true

# Release any existing hugepages from previous deploys
echo 0 > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages 2>/dev/null || true
echo 0 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages 2>/dev/null || true
sync && echo 3 > /proc/sys/vm/drop_caches
echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
sleep 2

PAGES_1G=$((MEMORY_MB / 1024))
REMAINDER_MB=$((MEMORY_MB - PAGES_1G * 1024))

echo "Target: ${MEMORY_MB}MB = ${PAGES_1G} x 1GB + ${REMAINDER_MB}MB remainder"
echo "Host RAM: $(free -m | awk '/Mem:/{print $2}')MB"

if [[ -d /sys/kernel/mm/hugepages/hugepages-1048576kB ]]; then
  echo "${PAGES_1G}" > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages
  sleep 2
  ACTUAL_1G=$(cat /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages)
  echo "1GB hugepages: requested=${PAGES_1G} allocated=${ACTUAL_1G}"

  if [[ "${ACTUAL_1G}" -lt "${PAGES_1G}" ]]; then
    # Couldn't get all 1GB pages — allocate remainder as 2MB
    ALLOCATED_MB=$((ACTUAL_1G * 1024))
    REMAINING_MB=$((MEMORY_MB - ALLOCATED_MB))
    PAGES_2M=$((REMAINING_MB / 2))
    TOTAL_REGIONS=$((ACTUAL_1G + PAGES_2M))
    echo "WARNING: Only got ${ACTUAL_1G} x 1GB, need ${PAGES_2M} x 2MB for remainder"
    echo "Total regions: ${TOTAL_REGIONS} (limit: 4096)"
    if [[ "${TOTAL_REGIONS}" -gt 4096 ]]; then
      echo "ERROR: Would exceed 4096 memory region limit (${TOTAL_REGIONS} regions)"
      echo "Need at least $((PAGES_1G - (PAGES_2M - 4096 + ACTUAL_1G) / 512 )) x 1GB pages"
      free -m
      exit 1
    fi
    echo "${PAGES_2M}" > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
    sleep 1
    ACTUAL_2M=$(cat /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages)
    echo "2MB hugepages: requested=${PAGES_2M} allocated=${ACTUAL_2M}"
  else
    PAGES_2M=0
    ACTUAL_2M=0
    if [[ "${REMAINDER_MB}" -gt 0 ]]; then
      PAGES_2M=$((REMAINDER_MB / 2))
      echo "${PAGES_2M}" > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
      ACTUAL_2M=$(cat /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages)
    fi
  fi
else
  echo "WARNING: No 1GB hugepage support — falling back to 2MB only"
  PAGES_2M=$((MEMORY_MB / 2))
  if [[ "${PAGES_2M}" -gt 4096 ]]; then
    echo "ERROR: Need ${PAGES_2M} x 2MB pages, exceeds 4096 region limit"
    echo "1GB hugepages required for ${MEMORY_MB}MB on this instance"
    exit 1
  fi
  echo "${PAGES_2M}" > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
  ACTUAL_1G=0
  ACTUAL_2M=$(cat /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages)
fi

TOTAL_ALLOC_MB=$((ACTUAL_1G * 1024 + ACTUAL_2M * 2))
echo "Hugepage allocation: ${ACTUAL_1G} x 1GB + ${ACTUAL_2M} x 2MB = ${TOTAL_ALLOC_MB}MB / ${MEMORY_MB}MB"
if [[ "${TOTAL_ALLOC_MB}" -lt "${MEMORY_MB}" ]]; then
  echo "ERROR: Insufficient hugepage memory (${TOTAL_ALLOC_MB}MB < ${MEMORY_MB}MB)"
  grep Huge /proc/meminfo
  free -m
  exit 1
fi

# Configure allocator to match (so systemd service dependencies work)
sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
sed -i "s/cpu_count: .*/cpu_count: ${CPU_COUNT}/" /etc/nitro_enclaves/allocator.yaml
# Start allocator — it should see pages are already allocated and not reallocate
systemctl start nitro-enclaves-allocator.service || true

echo "Host memory remaining: $(free -m | awk '/Mem:/{print $7}')MB available"

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

# ── 4. Clean up after EIF build ───────────────────────────────────
# Hugepages were pre-allocated in step 0.5 (before EIF build). Just clean Docker.
echo "=== Cleaning up after EIF build ==="
docker image prune -af
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

# Verify hugepages survived the EIF build (they should — hugepages are pinned)
echo "=== Verifying hugepage allocation ==="
for pool in /sys/kernel/mm/hugepages/hugepages-*; do
  size=$(basename "${pool}")
  nr=$(cat "${pool}/nr_hugepages" 2>/dev/null || echo "N/A")
  free=$(cat "${pool}/free_hugepages" 2>/dev/null || echo "N/A")
  echo "  ${size}: nr=${nr} free=${free}"
done
HUGETLB_KB=$(grep Hugetlb /proc/meminfo | awk '{print $2}')
EXPECTED_KB=$((MEMORY_MB * 1024))
echo "Hugetlb: ${HUGETLB_KB}kB (expected: ${EXPECTED_KB}kB)"
if [[ "${HUGETLB_KB}" -lt "${EXPECTED_KB}" ]]; then
  echo "ERROR: Hugepages were lost during EIF build!"
  grep Huge /proc/meminfo
  free -m
  exit 1
fi

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
if ! systemctl start tee-rex-enclave; then
  echo "ERROR: Enclave failed to start"
  echo "--- journalctl ---"
  journalctl -xeu tee-rex-enclave.service --no-pager -n 30 2>/dev/null || true
  echo "--- nitro-cli describe ---"
  nitro-cli describe-enclaves 2>/dev/null || true
  echo "--- nitro-cli version ---"
  nitro-cli --version 2>/dev/null || true
  echo "--- Hugepages ---"
  for pool in /sys/kernel/mm/hugepages/hugepages-*; do
    size=$(basename "${pool}")
    nr=$(cat "${pool}/nr_hugepages" 2>/dev/null || echo "N/A")
    free=$(cat "${pool}/free_hugepages" 2>/dev/null || echo "N/A")
    echo "  ${size}: nr=${nr} free=${free}"
  done
  grep Huge /proc/meminfo
  free -m
  exit 1
fi
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
