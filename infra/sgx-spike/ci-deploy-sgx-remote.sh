#!/usr/bin/env bash
# ci-deploy-sgx-remote.sh — Deploy the SGX worker on the VM itself.
#
# Runs on the SGX VM (files already in /tmp). No SCP needed.
#
# Usage: called by _deploy-sgx.yml or manually on the VM

set -euo pipefail

APP_DIR="/app"
SERVICE_NAME="tee-rex-sgx-worker"

echo "=== Installing SGX worker files ==="
sudo mkdir -p "${APP_DIR}"
sudo cp /tmp/worker.js "${APP_DIR}/worker.js"
sudo cp /tmp/worker.manifest.template "${APP_DIR}/worker.manifest.template"

echo "=== Building Gramine manifest ==="
cd "${APP_DIR}"
sudo gramine-manifest \
  -Dlog_level=error \
  -Darch_libdir=/lib/x86_64-linux-gnu \
  -Dra_type=dcap \
  worker.manifest.template worker.manifest

echo "=== Signing enclave ==="
sudo gramine-sgx-sign \
  --manifest worker.manifest \
  --output worker.manifest.sgx

echo "=== Installing systemd service ==="
sudo cp /tmp/tee-rex-sgx-worker.service /etc/systemd/system/${SERVICE_NAME}.service
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

echo "=== Waiting for service to start ==="
sleep 3
sudo systemctl status "${SERVICE_NAME}" --no-pager

echo "=== SGX worker deployed successfully ==="
