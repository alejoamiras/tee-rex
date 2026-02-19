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
rm -f "${EIF_PATH}"
rm -rf /tmp/nitro-artifacts 2>/dev/null || true
systemctl stop docker 2>/dev/null || true
rm -rf /var/lib/docker/*
systemctl start docker
journalctl --vacuum-size=50M 2>/dev/null || true

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
echo "=== Building EIF ==="
mkdir -p "${EIF_DIR}"
NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts nitro-cli build-enclave \
  --docker-uri "${IMAGE_URI}" \
  --output-file "${EIF_PATH}"

# ── 4. Clean up build image (after EIF build, image no longer needed) ─
echo "=== Cleaning up build image ==="
docker image prune -af
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

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
exit 1
