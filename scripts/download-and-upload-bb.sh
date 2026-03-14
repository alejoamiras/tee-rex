#!/usr/bin/env bash
# download-and-upload-bb.sh — Download bb from GitHub releases and upload to enclave.
#
# Usage: ./scripts/download-and-upload-bb.sh <version> [enclave_url]
# Example: ./scripts/download-and-upload-bb.sh 5.0.0-nightly.20260313
#          ./scripts/download-and-upload-bb.sh 5.0.0-nightly.20260313 http://localhost:4000
#
# Reusable by both the deploy script and manual operations.

set -euo pipefail

VERSION="${1:?Usage: download-and-upload-bb.sh <version> [enclave_url]}"
ENCLAVE_URL="${2:-http://localhost:4000}"
CACHE_DIR="${BB_CACHE_DIR:-/opt/tee-rex/bb-versions}"
BB_DIR="${CACHE_DIR}/${VERSION}"
BB_PATH="${BB_DIR}/bb"

echo "=== Download and upload bb v${VERSION} ==="
echo "Enclave URL: ${ENCLAVE_URL}"
echo "Cache dir: ${CACHE_DIR}"

# Download if not already cached
if [[ ! -f "${BB_PATH}" ]]; then
  echo "Downloading bb v${VERSION}..."
  mkdir -p "${BB_DIR}"
  curl -fSL "https://github.com/AztecProtocol/aztec-packages/releases/download/v${VERSION}/barretenberg-amd64-linux.tar.gz" \
    | tar -xzf - -C "${BB_DIR}" --strip-components=0
  chmod 755 "${BB_PATH}"
  echo "Downloaded bb v${VERSION} ($(du -sh "${BB_PATH}" | cut -f1))"
else
  echo "bb v${VERSION} already cached at ${BB_PATH}"
fi

# Upload to enclave
echo "Uploading bb v${VERSION} to enclave..."
RESPONSE=$(curl -sf -X POST "${ENCLAVE_URL}/upload-bb" \
  -H "x-bb-version: ${VERSION}" \
  --data-binary "@${BB_PATH}")
echo "Upload response: ${RESPONSE}"

# Verify
echo "Verifying enclave health..."
curl -sf "${ENCLAVE_URL}/health" | jq '{status, versions}'

echo "=== Done ==="
