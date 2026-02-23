#!/usr/bin/env bash
# ci-deploy-sgx.sh — Deploy the SGX enclave worker to the Azure VM.
#
# Prerequisites:
#   - SSH access to the Azure VM (SGX_VM_IP or tofu output)
#   - SGX_VM_USER (default: azureuser)
#   - SSH_KEY_PATH or ssh-agent configured
#
# Usage: ./ci-deploy-sgx.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_USER="${SGX_VM_USER:-azureuser}"
VM_IP="${SGX_VM_IP:?SGX_VM_IP must be set}"
SSH_KEY="${SSH_KEY_PATH:-}"
APP_DIR="/app"
SERVICE_NAME="tee-rex-sgx-worker"

# Build SSH options
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

ssh_cmd() {
  # shellcheck disable=SC2086,SC2029
  ssh $SSH_OPTS "${VM_USER}@${VM_IP}" "$@"
}

scp_cmd() {
  # shellcheck disable=SC2086
  scp $SSH_OPTS "$@"
}

echo "=== Deploying SGX worker to ${VM_USER}@${VM_IP} ==="

# 1. Upload worker files
echo "--- Uploading worker files ---"
scp_cmd "${SCRIPT_DIR}/worker.js" "${VM_USER}@${VM_IP}:/tmp/worker.js"
scp_cmd "${SCRIPT_DIR}/worker.manifest.template" "${VM_USER}@${VM_IP}:/tmp/worker.manifest.template"
scp_cmd "${SCRIPT_DIR}/tee-rex-sgx-worker.service" "${VM_USER}@${VM_IP}:/tmp/${SERVICE_NAME}.service"

# 2. Install files on the VM
echo "--- Installing files ---"
ssh_cmd "sudo mkdir -p ${APP_DIR} && sudo cp /tmp/worker.js ${APP_DIR}/worker.js"
ssh_cmd "sudo cp /tmp/worker.manifest.template ${APP_DIR}/worker.manifest.template"

# 3. Build Gramine manifest + sign
echo "--- Building Gramine manifest ---"
ssh_cmd "cd ${APP_DIR} && sudo gramine-manifest \
  -Dlog_level=error \
  -Darch_libdir=/lib/x86_64-linux-gnu \
  -Dra_type=dcap \
  worker.manifest.template worker.manifest"

echo "--- Signing enclave ---"
ssh_cmd "cd ${APP_DIR} && sudo gramine-sgx-sign \
  --manifest worker.manifest \
  --output worker.manifest.sgx"

# 4. Install and start systemd service
echo "--- Installing systemd service ---"
ssh_cmd "sudo cp /tmp/${SERVICE_NAME}.service /etc/systemd/system/${SERVICE_NAME}.service"
ssh_cmd "sudo systemctl daemon-reload"
ssh_cmd "sudo systemctl enable ${SERVICE_NAME}"
ssh_cmd "sudo systemctl restart ${SERVICE_NAME}"

# 5. Wait for service to start
echo "--- Waiting for service to start ---"
sleep 3
ssh_cmd "sudo systemctl status ${SERVICE_NAME} --no-pager"

echo "=== SGX worker deployed successfully ==="
