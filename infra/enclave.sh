#!/usr/bin/env bash
# enclave.sh — Build and run the TEE-Rex Nitro Enclave on an EC2 instance.
#
# Prerequisites:
#   - EC2 instance with Nitro Enclave support enabled
#   - nitro-cli installed: sudo amazon-linux-extras install aws-nitro-enclaves-cli
#   - Docker installed and the tee-rex-nitro image built:
#       docker build -f Dockerfile.nitro -t tee-rex-nitro .
#
# Usage:
#   ./enclave.sh [build|run|stop|describe]
#
# Environment variables:
#   CPU_COUNT  — vCPUs to allocate (default: 2)
#   MEMORY_MB  — Memory in MB (default: 4096)

set -euo pipefail

CPU_COUNT="${CPU_COUNT:-2}"
MEMORY_MB="${MEMORY_MB:-4096}"
EIF_PATH="tee-rex.eif"
DOCKER_IMAGE="tee-rex-nitro:latest"

cmd_build() {
  echo "Building enclave image from ${DOCKER_IMAGE}..."
  nitro-cli build-enclave \
    --docker-uri "${DOCKER_IMAGE}" \
    --output-file "${EIF_PATH}"
  echo ""
  echo "Enclave image built: ${EIF_PATH}"
  echo "Note the PCR values above — clients can use these to verify attestation."
}

cmd_run() {
  if [ ! -f "${EIF_PATH}" ]; then
    echo "Error: ${EIF_PATH} not found. Run './enclave.sh build' first."
    exit 1
  fi

  echo "Starting enclave (${CPU_COUNT} vCPUs, ${MEMORY_MB} MB)..."
  nitro-cli run-enclave \
    --eif-path "${EIF_PATH}" \
    --cpu-count "${CPU_COUNT}" \
    --memory "${MEMORY_MB}" \
    --enclave-cid 16

  echo ""
  echo "Enclave started. Run './proxy.sh' to start the TCP proxy."
  echo "To view enclave console: nitro-cli console --enclave-id \$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')"
}

cmd_stop() {
  local enclave_id
  enclave_id=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID // empty')
  if [ -z "${enclave_id}" ]; then
    echo "No running enclaves found."
    exit 0
  fi
  echo "Stopping enclave ${enclave_id}..."
  nitro-cli terminate-enclave --enclave-id "${enclave_id}"
}

cmd_describe() {
  nitro-cli describe-enclaves
}

case "${1:-run}" in
  build)    cmd_build ;;
  run)      cmd_run ;;
  stop)     cmd_stop ;;
  describe) cmd_describe ;;
  *)
    echo "Usage: $0 [build|run|stop|describe]"
    exit 1
    ;;
esac
