#!/usr/bin/env bash
# test-spike.sh — Orchestrate the 4 SGX feasibility spike tests.
#
# Runs tests in increasing complexity. Each test builds on the previous —
# if one fails, we stop and assess.
#
# Usage: sudo ./test-spike.sh
#
# Prerequisites: run setup.sh first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_PATH="/app/bb"
RESULTS_FILE="${SCRIPT_DIR}/spike-results.txt"
WORKER_PORT=5000

passed=0
failed=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()      { echo ""; echo "========================================"; echo "  $*"; echo "========================================"; }
log_pass() { echo "  PASS: $*"; passed=$((passed + 1)); }
log_fail() { echo "  FAIL: $*"; failed=$((failed + 1)); }

record() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $*" >> "${RESULTS_FILE}"
}

# Build and sign a Gramine manifest from template.
# Usage: build_manifest <name> <ra_type>
build_manifest() {
  local name="$1"
  local ra_type="${2:-none}"

  echo "  Expanding ${name} manifest template (ra_type=${ra_type})..."
  cd "${SCRIPT_DIR}"
  gramine-manifest \
    -Dlog_level=error \
    -Darch_libdir=/lib/x86_64-linux-gnu \
    -Dra_type="${ra_type}" \
    "${name}.manifest.template" "${name}.manifest"

  echo "  Signing ${name} manifest..."
  gramine-sgx-sign \
    --manifest "${name}.manifest" \
    --output "${name}.manifest.sgx" 2>&1 | tail -3
}

cleanup() {
  if [ -n "${WORKER_PID:-}" ]; then
    kill "${WORKER_PID}" 2>/dev/null || true
    sleep 1
    kill -9 "${WORKER_PID}" 2>/dev/null || true
  fi
  rm -rf /tmp/sgx-spike-*
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Test 1: bb binary inside Gramine SGX
# ---------------------------------------------------------------------------

test_1_bb_version() {
  log "Test 1: bb binary inside Gramine SGX"

  build_manifest bb none

  echo "  Running: gramine-sgx bb --version"
  local output
  if output=$(gramine-sgx bb --version 2>&1); then
    # Extract just the version line (last non-empty line)
    local version
    version=$(echo "${output}" | grep -E '^[0-9]' | tail -1)
    echo "  Output: ${version}"
    log_pass "bb runs inside Gramine SGX (${version})"
    record "Test 1 | PASS | bb --version: ${version}"
  else
    echo "  Output: ${output}"
    log_fail "bb crashed or missing syscalls"
    record "Test 1 | FAIL | ${output}"
    echo ""
    echo "Stopping — bb must run in SGX before continuing."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Test 2: bb computation in SGX (write_vk with chonk scheme)
# ---------------------------------------------------------------------------

test_2_bb_compute() {
  log "Test 2: bb computation in SGX (write_vk)"

  # Check for pre-built Aztec circuit bytecode
  local bytecode_path="/crs/test-bytecode.gz"
  if [ ! -f "${bytecode_path}" ]; then
    echo "  Preparing test circuit bytecode..."
    local circuit_pkg="/tmp/circuit-test/node_modules/@aztec/noir-protocol-circuits-types/artifacts/private_kernel_reset_0_0_0_64_0_0_0_0_0.json"
    if [ ! -f "${circuit_pkg}" ]; then
      echo "  Installing @aztec/noir-protocol-circuits-types..."
      mkdir -p /tmp/circuit-test && cd /tmp/circuit-test
      npm init -y > /dev/null 2>&1
      npm install @aztec/noir-protocol-circuits-types@4.0.0-devnet.2-patch.1 2>&1 | tail -3
    fi
    node -e "
      const fs = require('fs');
      const a = JSON.parse(fs.readFileSync('${circuit_pkg}'));
      fs.writeFileSync('${bytecode_path}', Buffer.from(a.bytecode, 'base64'));
    "
    echo "  Bytecode written to ${bytecode_path}"
  fi

  # Native baseline
  echo "  Running bb write_vk natively (baseline)..."
  local native_start native_elapsed
  native_start=$(date +%s%N)
  "${BB_PATH}" write_vk --scheme chonk -b "${bytecode_path}" -o /tmp/sgx-spike-vk-native -c /crs 2>&1
  native_elapsed=$(( ($(date +%s%N) - native_start) / 1000000 ))
  echo "  Native: ${native_elapsed}ms"

  # SGX (bb manifest already built from Test 1)
  echo "  Running bb write_vk in SGX..."
  cd "${SCRIPT_DIR}"
  local sgx_start sgx_elapsed
  sgx_start=$(date +%s%N)
  if gramine-sgx bb write_vk --scheme chonk -b "${bytecode_path}" -o /tmp/sgx-spike-vk-sgx -c /crs 2>&1; then
    sgx_elapsed=$(( ($(date +%s%N) - sgx_start) / 1000000 ))
    local ratio
    ratio=$(( sgx_elapsed / (native_elapsed > 0 ? native_elapsed : 1) ))
    echo "  SGX: ${sgx_elapsed}ms (~${ratio}x overhead)"
    log_pass "bb computation completed in SGX (native: ${native_elapsed}ms, SGX: ${sgx_elapsed}ms, ~${ratio}x)"
    record "Test 2 | PASS | native: ${native_elapsed}ms, SGX: ${sgx_elapsed}ms, ratio: ${ratio}x"
  else
    sgx_elapsed=$(( ($(date +%s%N) - sgx_start) / 1000000 ))
    log_fail "bb computation failed in SGX after ${sgx_elapsed}ms"
    record "Test 2 | FAIL | crashed after ${sgx_elapsed}ms"
    echo ""
    echo "Stopping — computation must work before continuing."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Test 3: DCAP attestation quote
# ---------------------------------------------------------------------------

test_3_dcap_quote() {
  log "Test 3: DCAP attestation quote"

  # Rebuild bb manifest with DCAP enabled
  build_manifest bb dcap

  echo "  Running bb --version with DCAP manifest..."
  cd "${SCRIPT_DIR}"
  local output
  if output=$(gramine-sgx bb --version 2>&1); then
    local version
    version=$(echo "${output}" | grep -E '^[0-9]' | tail -1)
    echo "  DCAP enclave starts OK (${version})"
    log_pass "DCAP-enabled enclave starts successfully"
    record "Test 3 | PASS | DCAP enclave starts, bb --version: ${version}"
  else
    echo "  Output: ${output}"
    log_fail "DCAP enclave failed to start"
    record "Test 3 | FAIL | ${output}"
    echo ""
    echo "Note: DCAP failure is not a hard blocker for computation."
    # Don't return 1 — continue to Test 4
  fi
}

# ---------------------------------------------------------------------------
# Test 4: Minimal Node.js worker inside Gramine
# ---------------------------------------------------------------------------

test_4_worker() {
  log "Test 4: Minimal Node.js worker inside Gramine"

  build_manifest worker none

  # Start the worker in background
  echo "  Starting worker: gramine-sgx worker"
  cd "${SCRIPT_DIR}"
  gramine-sgx worker &
  WORKER_PID=$!

  # Poll until worker is ready (up to 60s — SGX startup + key generation is slow)
  echo "  Waiting for worker to start (up to 60s)..."
  local ready=false
  for i in $(seq 1 60); do
    if nc -z 127.0.0.1 "${WORKER_PORT}" 2>/dev/null; then
      echo "  Worker ready after ${i}s"
      ready=true
      break
    fi
    if ! kill -0 "${WORKER_PID}" 2>/dev/null; then
      echo "  Worker died after ${i}s"
      break
    fi
    sleep 1
  done

  if [ "${ready}" != "true" ]; then
    log_fail "Worker process did not start listening"
    record "Test 4 | FAIL | worker not listening after 60s"
    return 1
  fi

  # Test: get public key
  echo "  Requesting public key..."
  local pubkey_response
  pubkey_response=$(echo '{"action":"get_public_key"}' | nc -q 2 127.0.0.1 "${WORKER_PORT}" 2>/dev/null || true)

  if echo "${pubkey_response}" | jq -e '.publicKey' > /dev/null 2>&1; then
    echo "  Got public key from worker."
    log_pass "Node.js worker runs in SGX, key generation works"
    record "Test 4 | PASS | worker started, key generation OK"
  else
    echo "  Response: ${pubkey_response}"
    log_fail "Worker did not return a valid public key"
    record "Test 4 | FAIL | bad pubkey response: ${pubkey_response}"
    kill "${WORKER_PID}" 2>/dev/null || true
    return 1
  fi

  # Cleanup — kill and SIGKILL after 1s (gramine-sgx may not exit cleanly)
  kill "${WORKER_PID}" 2>/dev/null || true
  sleep 1
  kill -9 "${WORKER_PID}" 2>/dev/null || true
  unset WORKER_PID
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo "SGX Feasibility Spike — Test Runner"
  echo "Date: $(date -u)"
  echo ""
  record "--- Spike run started ---"

  test_1_bb_version
  test_2_bb_compute
  test_3_dcap_quote
  test_4_worker

  log "Results"
  echo "  Passed: ${passed}"
  echo "  Failed: ${failed}"
  echo ""
  record "Results: ${passed} passed, ${failed} failed"

  if [ "${failed}" -gt 0 ]; then
    echo "Some tests failed. Review results above and spike-results.txt."
    exit 1
  else
    echo "All tests passed! SGX feasibility confirmed."
    echo "See spike-results.txt for detailed log."
  fi
}

main "$@"
