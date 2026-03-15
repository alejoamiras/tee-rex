#!/usr/bin/env bash
# ci-deploy-unified.sh — Deploy tee-rex enclave + host on a single instance.
# Intended to be executed via AWS SSM on the EC2 instance.
#
# Usage: ci-deploy-unified.sh <nitro-image-uri> <host-image-uri> [bb-versions]
# Example: ci-deploy-unified.sh \
#   <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:prod-tee \
#   <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:prod-host \
#   "5.0.0-nightly.20260313"
#
# Architecture:
#   Enclave (port 4000 via socat): thin service handling crypto + proving
#   Host container (port 80): Bun.serve proxy, bb version management
#   bb binaries: downloaded by host, uploaded to enclave at runtime

set -euo pipefail

NITRO_IMAGE_URI="${1:?Usage: ci-deploy-unified.sh <nitro-image-uri> <host-image-uri> [bb-versions]}"
HOST_IMAGE_URI="${2:?Usage: ci-deploy-unified.sh <nitro-image-uri> <host-image-uri> [bb-versions]}"
BB_VERSIONS="${3:-}"
REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
EIF_DIR="/opt/tee-rex"
EIF_PATH="${EIF_DIR}/tee-rex.eif"
BUILD_ARTIFACTS="${EIF_DIR}/build-artifacts"
ENCLAVE_CID=16
HOST_CONTAINER_NAME="tee-rex-host"
BB_CACHE_DIR="/opt/tee-rex/bb-versions"

# Auto-detect host resources, reserve minimum for host OS + host container
TOTAL_VCPUS=$(nproc --all)
TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
CPU_COUNT=$(( TOTAL_VCPUS - 2 ))           # Reserve 2 vCPUs for host
MEMORY_MB=$(( TOTAL_MEM_MB - 16384 ))      # Reserve 16GB for host

# Minimum viable enclave: 2 vCPUs, 8GB
if [[ "${CPU_COUNT}" -lt 2 ]]; then CPU_COUNT=2; fi
if [[ "${MEMORY_MB}" -lt 8192 ]]; then MEMORY_MB=8192; fi

echo "=== TEE-Rex Unified CI Deploy ==="
echo "Nitro image: ${NITRO_IMAGE_URI}"
echo "Host image: ${HOST_IMAGE_URI}"
echo "BB versions: ${BB_VERSIONS:-<none>}"
echo "Region: ${REGION}"
echo "Host: ${TOTAL_VCPUS} vCPUs, ${TOTAL_MEM_MB}MB RAM"
echo "Enclave: ${CPU_COUNT} vCPUs, ${MEMORY_MB}MB RAM"

# ── 0. Tear down existing enclave + proxy + host container + reclaim disk ──
echo "=== Tearing down existing services ==="
systemctl stop tee-rex-proxy 2>/dev/null || true
systemctl stop tee-rex-enclave 2>/dev/null || true
nitro-cli terminate-enclave --all 2>/dev/null || true
pkill -f "socat.*TCP-LISTEN:4000" 2>/dev/null || true
docker stop "${HOST_CONTAINER_NAME}" 2>/dev/null || true
docker rm "${HOST_CONTAINER_NAME}" 2>/dev/null || true
rm -f "${EIF_PATH}"
rm -rf "${BUILD_ARTIFACTS}" 2>/dev/null || true
find /tmp -maxdepth 1 -type f -size +10M -delete 2>/dev/null || true
systemctl stop docker 2>/dev/null || true
rm -rf /var/lib/docker/*
systemctl start docker
journalctl --vacuum-size=50M 2>/dev/null || true

# ── 1. Hugepage strategy ──────────────────────────────────────────
HUGEPAGE_1G_DIR="/sys/kernel/mm/hugepages/hugepages-1048576kB"
HUGEPAGE_2M_DIR="/sys/kernel/mm/hugepages/hugepages-2048kB"
MIN_HOST_MB=10240  # 10GB for host + Docker pull + linuxkit EIF build
AVAIL_AFTER_HUGEPAGES=$(( TOTAL_MEM_MB - MEMORY_MB ))
DEFER_HUGEPAGES=false

echo "=== Hugepage strategy (${MEMORY_MB}MB enclave, ${TOTAL_MEM_MB}MB total, ${AVAIL_AFTER_HUGEPAGES}MB would remain) ==="

if (( AVAIL_AFTER_HUGEPAGES < MIN_HOST_MB )); then
  echo "Deferring hugepages (${AVAIL_AFTER_HUGEPAGES}MB < ${MIN_HOST_MB}MB minimum for host)"
  sed -i "s/memory_mib: .*/memory_mib: 512/" /etc/nitro_enclaves/allocator.yaml
  systemctl restart nitro-enclaves-allocator.service || true
  sleep 2
  DEFER_HUGEPAGES=true
elif [[ -d "${HUGEPAGE_1G_DIR}" ]]; then
  echo "Pre-allocating hugepages (${AVAIL_AFTER_HUGEPAGES}MB headroom for host)"
  sync && echo 3 > /proc/sys/vm/drop_caches
  echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
  sleep 2

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
  echo "No 1GB hugepage support — using 2MB pages (pre-allocating)"
  sync && echo 3 > /proc/sys/vm/drop_caches
  echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true
  sleep 2
fi

if [[ "${DEFER_HUGEPAGES}" != "true" ]]; then
  sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
fi
sed -i "s/cpu_count: .*/cpu_count: ${CPU_COUNT}/" /etc/nitro_enclaves/allocator.yaml
echo "Restarting allocator with cpu_count=${CPU_COUNT}, memory_mib=$(grep memory_mib /etc/nitro_enclaves/allocator.yaml | awk '{print $2}')"
systemctl restart nitro-enclaves-allocator.service
sleep 3

# ── 2. Disk space check ──────────────────────────────────────────
AVAIL_MB=$(df -BM / | tail -1 | awk '{print $4}' | tr -d 'M')
echo "Disk space available: ${AVAIL_MB}MB"
if [[ "${AVAIL_MB}" -lt 4096 ]]; then
  echo "ERROR: Insufficient disk space (${AVAIL_MB}MB < 4096MB required)"
  exit 1
fi

# ── 3. ECR login + pull nitro image ──────────────────────────────
echo "=== Pulling nitro image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${NITRO_IMAGE_URI%%/*}"
docker pull "${NITRO_IMAGE_URI}"

# ── 4. Build EIF ─────────────────────────────────────────────────
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

if [[ "${DEFER_HUGEPAGES}" == "true" ]]; then
  sed -i "s/memory_mib: .*/memory_mib: ${MEMORY_MB}/" /etc/nitro_enclaves/allocator.yaml
  echo "=== Allocating deferred hugepages (${MEMORY_MB}MB) ==="

  if [[ -d "${HUGEPAGE_1G_DIR}" ]]; then
    PAGES_1G=$(( MEMORY_MB / 1024 ))
    REMAINDER_MB=$(( MEMORY_MB - PAGES_1G * 1024 ))
    echo "Attempting ${PAGES_1G} x 1GB pages"
    echo "${PAGES_1G}" > "${HUGEPAGE_1G_DIR}/nr_hugepages"
    sleep 2
    ACTUAL_1G=$(cat "${HUGEPAGE_1G_DIR}/nr_hugepages")
    echo "1GB hugepages allocated: ${ACTUAL_1G}/${PAGES_1G}"

    if [[ "${REMAINDER_MB}" -gt 0 ]]; then
      PAGES_2M=$(( REMAINDER_MB / 2 ))
      echo "${PAGES_2M}" > "${HUGEPAGE_2M_DIR}/nr_hugepages"
      sleep 1
    fi
  fi

  ALLOC_OK=false
  for attempt in 1 2; do
    if systemctl restart nitro-enclaves-allocator.service; then
      sleep 3
      HUGETLB_KB=$(awk '/Hugetlb/ {print $2}' /proc/meminfo)
      HUGETLB_MB=$(( HUGETLB_KB / 1024 ))
      echo "Total hugepage memory: ${HUGETLB_MB}MB (attempt ${attempt})"
      if [[ "${HUGETLB_MB}" -gt 0 ]]; then
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
  if RESPONSE=$(curl -sf http://localhost:4000/health 2>/dev/null) && \
     echo "${RESPONSE}" | jq -e '.status' > /dev/null 2>&1; then
    echo "Enclave healthy (attempt ${i})"
    echo "${RESPONSE}" | jq '{status, versions}'
    break
  fi
  if [[ "${i}" -eq 120 ]]; then
    echo "ERROR: Enclave health check failed after 10 minutes"
    echo "=== Diagnostics ==="
    nitro-cli describe-enclaves 2>/dev/null || echo "nitro-cli not available"
    systemctl status tee-rex-enclave --no-pager -l 2>/dev/null || true
    systemctl status tee-rex-proxy --no-pager -l 2>/dev/null || true
    grep Huge /proc/meminfo
    free -m
    df -h /
    exit 1
  fi
  sleep 5
done

# ── 9. Download bb + upload to enclave ────────────────────────────
if [[ -n "${BB_VERSIONS}" ]]; then
  echo "=== Downloading and uploading bb versions ==="
  mkdir -p "${BB_CACHE_DIR}"
  for version in $(echo "${BB_VERSIONS}" | tr ',' ' '); do
    BB_DIR="${BB_CACHE_DIR}/${version}"
    BB_PATH="${BB_DIR}/bb"

    # Download if not already cached on host
    if [[ ! -f "${BB_PATH}" ]]; then
      echo "Downloading bb v${version}..."
      mkdir -p "${BB_DIR}"
      curl -fSL "https://github.com/AztecProtocol/aztec-packages/releases/download/v${version}/barretenberg-amd64-linux.tar.gz" \
        | tar -xzf - -C "${BB_DIR}" --strip-components=0
      chmod 755 "${BB_PATH}"
      echo "Downloaded bb v${version}"
    else
      echo "bb v${version} already cached on host"
    fi

    # Upload to enclave
    echo "Uploading bb v${version} to enclave..."
    UPLOAD_RESPONSE=$(curl -sf --max-time 300 -X POST http://localhost:4000/upload-bb \
      -H "x-bb-version: ${version}" \
      --data-binary "@${BB_PATH}" 2>&1) || {
      echo "ERROR: Failed to upload bb v${version} to enclave"
      echo "Response: ${UPLOAD_RESPONSE}"
      echo "Enclave health: $(curl -sf --max-time 5 http://localhost:4000/health 2>&1 || echo 'unreachable')"
      exit 1
    }
    echo "Uploaded: ${UPLOAD_RESPONSE}"
  done

  # Verify enclave has the versions
  echo "=== Verifying enclave bb versions ==="
  curl -sf http://localhost:4000/health | jq '{status, versions}'
fi

# ── 10. Pull + run host container ──────────────────────────────────
echo "=== Deploying host container ==="
echo "Pulling host image: ${HOST_IMAGE_URI}"
docker pull "${HOST_IMAGE_URI}"

# Bun.serve() binds privileged ports as non-root on Linux when
# net.ipv4.ip_unprivileged_port_start <= port. Default is 1024, so we lower it.
sysctl -w net.ipv4.ip_unprivileged_port_start=80

echo "=== Starting host container ==="
docker run -d \
  --name "${HOST_CONTAINER_NAME}" \
  --network host \
  -e NODE_ENV=production \
  -e TEE_MODE=nitro \
  -e ENCLAVE_URL=http://localhost:4000 \
  -e PORT=80 \
  -e HARDWARE_CONCURRENCY="$(nproc)" \
  --restart unless-stopped \
  "${HOST_IMAGE_URI}"

docker image prune -af

# ── 11. Host health check ─────────────────────────────────────────
echo "=== Host health check ==="
for i in $(seq 1 120); do
  if RESPONSE=$(curl -sf http://localhost:80/health 2>/dev/null) && \
     echo "${RESPONSE}" | jq -e '.status' > /dev/null 2>&1; then
    echo "Host healthy (attempt ${i})"
    echo "${RESPONSE}" | jq '{status, api_version, available_versions, bb_hashes}'
    break
  fi
  if [[ "${i}" -eq 120 ]]; then
    echo "ERROR: Host health check failed after 10 minutes"
    docker ps -a --filter "name=${HOST_CONTAINER_NAME}" 2>/dev/null || true
    docker logs "${HOST_CONTAINER_NAME}" --tail 30 2>/dev/null || true
    free -m
    exit 1
  fi
  sleep 5
done

echo "=== Unified deploy complete ==="
echo "Enclave: port 4000 (thin enclave service)"
echo "Host:    port 80   (Bun.serve proxy, TEE_MODE=nitro)"
