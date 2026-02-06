#!/usr/bin/env bash
# proxy.sh — Run on the parent EC2 instance to bridge TCP traffic to the Nitro Enclave.
#
# Forwards HTTP traffic from TCP port 4000 to the enclave's vsock port 5000.
# Clients (the SDK) connect to the EC2 instance's public IP on port 4000.
#
# Prerequisites:
#   - socat installed: sudo yum install -y socat
#   - A running enclave (see enclave.sh)
#
# Usage:
#   ./proxy.sh [ENCLAVE_CID]
#
# The enclave CID can be found in the output of `nitro-cli describe-enclaves`.
# If not provided, defaults to CID 16 (the first enclave on the instance).

set -euo pipefail

ENCLAVE_CID="${1:-16}"
LISTEN_PORT="${LISTEN_PORT:-4000}"
VSOCK_PORT="${VSOCK_PORT:-5000}"

echo "Proxying TCP :${LISTEN_PORT} → vsock ${ENCLAVE_CID}:${VSOCK_PORT}"
exec socat TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr VSOCK-CONNECT:${ENCLAVE_CID}:${VSOCK_PORT}
