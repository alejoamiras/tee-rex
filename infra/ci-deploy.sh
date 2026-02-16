#!/usr/bin/env bash
# ci-deploy.sh — Deploy tee-rex enclave from a fresh Docker image.
# Intended to be executed via AWS SSM on the CI EC2 instance.
#
# Usage: ci-deploy.sh <ecr-image-uri>
# Example: ci-deploy.sh <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:nightly
#
# Lessons applied from lessons/ssm-deployment.md:
#   L1: nitro-cli must run as ec2-user (NITRO_CLI_ARTIFACTS in their profile)
#   L2: socat must be detached from SSM (setsid + disown)
#   L3: Old EIF must be removed as root (may have been created by root)
#   L6: Enclave CID comes from run-enclave output (may differ from requested)

set -euo pipefail

IMAGE_URI="${1:?Usage: ci-deploy.sh <ecr-image-uri>}"
REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
EIF_PATH="/tmp/tee-rex.eif"
CPU_COUNT=2
MEMORY_MB=6144

echo "=== TEE-Rex CI Deploy ==="
echo "Image: ${IMAGE_URI}"
echo "Region: ${REGION}"

# ── 1. Tear down existing enclave + proxy + old images ───────────
echo "=== Tearing down existing enclave ==="
sudo -u ec2-user nitro-cli terminate-enclave --all 2>/dev/null || true
pkill socat 2>/dev/null || true
rm -f "${EIF_PATH}"
rm -rf /tmp/nitro-artifacts 2>/dev/null || true
# Clean up old Docker resources (images, containers, build cache).
# EBS volumes are 20GB — docker prune reliably reclaims overlay2 layers.
docker system prune -af
# Also clean system logs that accumulate over time
journalctl --vacuum-size=50M 2>/dev/null || true
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

# ── 2. Pull Docker image ──────────────────────────────────────────
echo "=== Pulling image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${IMAGE_URI%%/*}"
docker pull "${IMAGE_URI}"

# ── 3. Build EIF (as ec2-user — needs NITRO_CLI_ARTIFACTS) ───────
echo "=== Building EIF ==="
sudo -u ec2-user bash -lc \
  "NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts nitro-cli build-enclave \
    --docker-uri '${IMAGE_URI}' \
    --output-file '${EIF_PATH}'"

# ── 4. Run enclave (as ec2-user) ──────────────────────────────────
echo "=== Running enclave ==="
ENCLAVE_OUT=$(sudo -u ec2-user bash -lc \
  "nitro-cli run-enclave \
    --eif-path '${EIF_PATH}' \
    --cpu-count ${CPU_COUNT} \
    --memory ${MEMORY_MB} \
    --enclave-cid 16")
echo "${ENCLAVE_OUT}"

CID=$(echo "${ENCLAVE_OUT}" | jq -r '.EnclaveCID // 16')
echo "Enclave CID: ${CID}"

# ── 5. Start socat proxy (detached from SSM) ──────────────────────
echo "=== Starting proxy (CID=${CID}) ==="
setsid socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:${CID}:5000 \
  > /dev/null 2>&1 &
disown

# ── 6. Health check ───────────────────────────────────────────────
echo "=== Health check ==="
for i in $(seq 1 120); do
  if curl -sf http://localhost:4000/attestation > /dev/null 2>&1; then
    echo "Enclave healthy (attempt ${i})"
    curl -s http://localhost:4000/attestation | jq '{mode, hasDoc: (.attestationDocument != null)}'
    echo "=== Deploy complete ==="
    exit 0
  fi
  sleep 5
done

echo "ERROR: Health check failed after 10 minutes"
exit 1
