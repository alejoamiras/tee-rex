#!/usr/bin/env bash
# ci-deploy-prover.sh — Deploy tee-rex prover from a fresh Docker image.
# Intended to be executed via AWS SSM on the CI EC2 instance.
#
# Usage: ci-deploy-prover.sh <ecr-image-uri>
# Example: ci-deploy-prover.sh <ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:prover

set -euo pipefail

IMAGE_URI="${1:?Usage: ci-deploy-prover.sh <ecr-image-uri>}"
REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
CONTAINER_NAME="tee-rex"

echo "=== TEE-Rex Prover CI Deploy ==="
echo "Image: ${IMAGE_URI}"
echo "Region: ${REGION}"

# ── 0. Disk space pre-check ──────────────────────────────────────
AVAIL_MB=$(df -BM / | tail -1 | awk '{print $4}' | tr -d 'M')
echo "Disk space available: ${AVAIL_MB}MB"
if [[ "${AVAIL_MB}" -lt 4096 ]]; then
  echo "ERROR: Insufficient disk space (${AVAIL_MB}MB < 4096MB required)"
  echo "Consider increasing EBS volume or running docker system prune"
  exit 1
fi

# ── 1. Stop existing container ──────────────────────────────────
echo "=== Stopping existing container ==="
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

# ── 2. Pull new image (reuses cached layers from previous deploy) ─
echo "=== Pulling image ==="
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${IMAGE_URI%%/*}"
docker pull "${IMAGE_URI}"

# ── 3. Run container ───────────────────────────────────────────
echo "=== Starting container ==="
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p 80:80 \
  --restart unless-stopped \
  "${IMAGE_URI}"

# ── 4. Clean up old images (after pull, so layers are reused) ──
echo "=== Cleaning up old images ==="
docker image prune -af
journalctl --vacuum-size=50M 2>/dev/null || true
echo "Disk space after cleanup: $(df -h / | tail -1 | awk '{print $4 " available"}')"

# ── 5. Health check ────────────────────────────────────────────
echo "=== Health check ==="
for i in $(seq 1 120); do
  if curl -sf http://localhost:80/attestation > /dev/null 2>&1; then
    echo "Prover healthy (attempt ${i})"
    curl -s http://localhost:80/attestation | jq '{mode}'
    echo "=== Deploy complete ==="
    exit 0
  fi
  sleep 5
done

echo "ERROR: Health check failed after 10 minutes"
exit 1
