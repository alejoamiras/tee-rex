#!/usr/bin/env bash
# setup-alibaba.sh — Provision an Alibaba Cloud g7t SGX VM.
#
# Run on a fresh Ubuntu 22.04 ECS instance (g7t.xlarge):
#   chmod +x setup-alibaba.sh && sudo ./setup-alibaba.sh
#
# What it does:
#   1. Adds Intel SGX + Gramine apt repos
#   2. Installs gramine, sgx-aesm-service, DCAP libraries
#   3. Configures Alibaba Cloud PCCS (quote collateral service)
#   4. Verifies SGX hardware (is-sgx-available)
#   5. Installs Node.js 20 LTS
#   6. Generates Gramine signing key
#   7. Downloads Aztec CRS files
#   8. Extracts bb binary from npm package

set -euo pipefail

CRS_DIR="/crs"
BB_DIR="/app"
VM_USER="${SGX_VM_USER:-ecs-user}"
ALIBABA_REGION="${ALIBABA_REGION:-cn-hongkong}"

log() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# 1. System packages & Intel SGX repo
# ---------------------------------------------------------------------------
log "Updating system packages..."
apt-get update -y
apt-get install -y curl gnupg2 apt-transport-https ca-certificates jq

CODENAME=$(lsb_release -cs)  # jammy for 22.04
mkdir -p /etc/apt/keyrings

log "Adding Intel SGX APT repository..."
curl -fsSLo /etc/apt/keyrings/intel-sgx-deb.asc \
  https://download.01.org/intel-sgx/sgx_repo/ubuntu/intel-sgx-deb.key
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/intel-sgx-deb.asc] https://download.01.org/intel-sgx/sgx_repo/ubuntu ${CODENAME} main" \
  > /etc/apt/sources.list.d/intel-sgx.list

log "Adding Gramine APT repository (per-codename key)..."
curl -fsSLo "/etc/apt/keyrings/gramine-keyring-${CODENAME}.gpg" \
  "https://packages.gramineproject.io/gramine-keyring-${CODENAME}.gpg"
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/gramine-keyring-${CODENAME}.gpg] https://packages.gramineproject.io/ ${CODENAME} main" \
  > /etc/apt/sources.list.d/gramine.list

apt-get update -y

# ---------------------------------------------------------------------------
# 2. Install SGX + Gramine + DCAP libraries
# ---------------------------------------------------------------------------
log "Installing SGX, Gramine, and DCAP libraries..."
apt-get install -y \
  gramine \
  libsgx-launch libsgx-urts libsgx-epid libsgx-quote-ex \
  libsgx-dcap-ql libsgx-dcap-default-qpl \
  sgx-aesm-service \
  linux-tools-common

# ---------------------------------------------------------------------------
# 3. Configure Alibaba Cloud PCCS for DCAP quote verification
# ---------------------------------------------------------------------------
log "Configuring Alibaba Cloud PCCS (region: ${ALIBABA_REGION})..."
PCCS_URL="https://sgx-dcap-server-${ALIBABA_REGION}.${ALIBABA_REGION}.aliyuncs.com/sgx/certification/v4/"

cat > /etc/sgx_default_qcnl.conf <<EOF
{
  "pccs_url": "${PCCS_URL}",
  "use_secure_cert": true,
  "collateral_service": "${PCCS_URL}"
}
EOF

log "PCCS configured: ${PCCS_URL}"

# Start AESM service
systemctl enable aesmd
systemctl start aesmd

# ---------------------------------------------------------------------------
# 4. Verify SGX hardware
# ---------------------------------------------------------------------------
log "Verifying SGX hardware support..."
if is-sgx-available; then
  log "SGX hardware verified."
else
  echo "ERROR: SGX hardware not available. Check instance type (needs g7t)."
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Install Node.js 20 LTS
# ---------------------------------------------------------------------------
log "Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version

# Install openpgp for the worker script
log "Installing openpgp for worker..."
mkdir -p "${BB_DIR}"
cd "${BB_DIR}"
npm init -y > /dev/null 2>&1
npm install openpgp@5

# ---------------------------------------------------------------------------
# 6. Generate Gramine signing key
# ---------------------------------------------------------------------------
log "Generating Gramine SGX signing key..."
if [ ! -f "/home/${VM_USER}/.config/gramine/enclave-key.pem" ]; then
  sudo -u "${VM_USER}" gramine-sgx-gen-private-key
fi
log "Signing key ready."

# ---------------------------------------------------------------------------
# 7. Download CRS files
# ---------------------------------------------------------------------------
log "Downloading Aztec CRS files to ${CRS_DIR}..."
mkdir -p "${CRS_DIR}"

# bn254_g1.dat — ~512MB, download with Range header fallback
if [ ! -f "${CRS_DIR}/bn254_g1.dat" ]; then
  curl -fSL -o "${CRS_DIR}/bn254_g1.dat" \
    "https://aztec-ignition.s3.eu-west-2.amazonaws.com/MAIN+IGNITION/flat/g1.dat"
fi

# bn254_g2.dat — 128 bytes
if [ ! -f "${CRS_DIR}/bn254_g2.dat" ]; then
  curl -fSL -o "${CRS_DIR}/bn254_g2.dat" \
    "https://aztec-ignition.s3.eu-west-2.amazonaws.com/MAIN+IGNITION/flat/g2.dat"
fi

# grumpkin_g1.dat — ~16MB
if [ ! -f "${CRS_DIR}/grumpkin_g1.dat" ]; then
  curl -fSL -o "${CRS_DIR}/grumpkin_g1.dat" \
    "https://aztec-ignition.s3.eu-west-2.amazonaws.com/TEST+GRUMPKIN/monomial/transcript00.dat"
fi

log "CRS files downloaded."
ls -lh "${CRS_DIR}/"

# ---------------------------------------------------------------------------
# 8. Install bb binary from @aztec/bb.js (native binary included in package)
# ---------------------------------------------------------------------------
log "Installing bb binary..."
BB_INSTALL_DIR="/tmp/bb-install"
rm -rf "${BB_INSTALL_DIR}"
mkdir -p "${BB_INSTALL_DIR}"
cd "${BB_INSTALL_DIR}"
npm init -y > /dev/null 2>&1
npm install @aztec/bb.js@5.0.0-nightly.20260223

BB_SRC="${BB_INSTALL_DIR}/node_modules/@aztec/bb.js/build/amd64-linux/bb"
if [ -f "${BB_SRC}" ]; then
  cp "${BB_SRC}" "${BB_DIR}/bb"
  chmod +x "${BB_DIR}/bb"
  log "bb binary installed at ${BB_DIR}/bb"
  "${BB_DIR}/bb" --version || true
else
  log "WARNING: bb binary not found in @aztec/bb.js package. Copy bb manually."
fi
rm -rf "${BB_INSTALL_DIR}"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "Setup complete. Run test-spike.sh to start the spike tests."
log ""
log "Summary:"
log "  SGX:    $(is-sgx-available && echo 'available' || echo 'NOT available')"
log "  Node:   $(node --version)"
log "  bb:     ${BB_DIR}/bb"
log "  CRS:    ${CRS_DIR}/"
log "  Key:    /home/${VM_USER}/.config/gramine/enclave-key.pem"
log "  PCCS:   ${PCCS_URL}"
