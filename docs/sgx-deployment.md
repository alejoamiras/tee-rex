# SGX Deployment Guide

Step-by-step guide to provisioning and deploying the TEE-Rex SGX enclave worker on Azure.

## Prerequisites

- Azure subscription with access to DCdsv3/DCdsv5 VM sizes (confidential computing)
- SSH key pair configured
- OpenTofu installed (for VM provisioning)
- The `bb` binary matching the SDK's `@aztec/bb.js` version

## 1. Provision the Azure VM

The VM is managed by OpenTofu in `infra/tofu/azure.tf`.

```bash
cd infra/tofu
tofu plan    # Review changes
tofu apply   # Provision VM
```

This creates:
- **Resource group**: `tee-rex-sgx-spike` (single destroy target)
- **VM**: `Standard_DC4ds_v3` (4 vCPU, 32GB RAM, **16GB EPC**)
- **Network**: VNet + subnet + NSG (SSH:22, Express:4000)
- **Public IP**: Static (for CloudFront origin)

Get the VM IP:
```bash
tofu output sgx_spike_public_ip    # e.g., 20.121.207.246
tofu output sgx_spike_ssh          # ssh azureuser@20.121.207.246
```

### VM Size Selection

| Size | vCPU | RAM | EPC | Cost/hr | Notes |
|------|:----:|:---:|:---:|:-------:|-------|
| DC2ds_v3 | 2 | 16GB | 8GB | ~$0.22 | Too small (bb needs ~283MB + Gramine overhead) |
| **DC4ds_v3** | **4** | **32GB** | **16GB** | **~$0.45** | **Recommended** — 16GB EPC fits bb comfortably |
| DC8ds_v3 | 8 | 64GB | 32GB | ~$0.90 | Overkill unless running concurrent proofs |

**EPC (Enclave Page Cache)** is the hardware-encrypted memory available to SGX enclaves. bb's peak memory is ~283MB, but Gramine adds overhead (thread stacks, libc, Node.js runtime). 16GB EPC ensures no EPC paging.

## 2. Initial VM Setup

SSH into the VM and run the provisioning script:

```bash
ssh azureuser@<VM_IP>
# Upload and run setup script
scp infra/sgx-spike/setup.sh azureuser@<VM_IP>:/tmp/setup.sh
ssh azureuser@<VM_IP> "chmod +x /tmp/setup.sh && sudo /tmp/setup.sh"
```

The setup script (`infra/sgx-spike/setup.sh`) installs:

1. **Intel SGX packages**: `gramine`, `libsgx-*`, `sgx-aesm-service`
2. **Azure DCAP**: `az-dcap-client` (quote provider for attestation)
3. **Node.js 20 LTS** + `openpgp@5` (for enclave key management)
4. **Gramine signing key** (per-user, used to sign enclave manifests)
5. **Aztec CRS files** (~530MB total):
   - `bn254_g1.dat` (~512MB) — BN254 G1 SRS points
   - `bn254_g2.dat` (128 bytes) — BN254 G2 SRS point
   - `grumpkin_g1.dat` (~16MB) — Grumpkin SRS points
6. **bb binary** from `@aztec/bb.js` npm package

### bb Version Matching (Critical)

The `bb` binary on the VM **must exactly match** the SDK's `@aztec/bb.js` version. A version mismatch causes:
```
The prove command for Chonk expect a valid file passed with --ivc_inputs_path
```

To get the correct binary:
```bash
# On your local machine, find the binary in node_modules
ls node_modules/.bun/@aztec+bb.js@<VERSION>/node_modules/@aztec/bb.js/build/amd64-linux/bb

# Upload to VM
scp <path-to-bb> azureuser@<VM_IP>:/app/bb
ssh azureuser@<VM_IP> "sudo chmod +x /app/bb && /app/bb --version"
```

Verify the version matches:
```bash
# Local
node -e "console.log(require('@aztec/bb.js/package.json').version)"
# VM
/app/bb --version
```

## 3. Deploy the SGX Worker

Use the deploy script:

```bash
export SGX_VM_IP=20.121.207.246
./infra/sgx-spike/ci-deploy-sgx.sh
```

Or manually:

```bash
# 1. Upload worker files
scp infra/sgx-spike/worker.js azureuser@$VM_IP:/tmp/worker.js
scp infra/sgx-spike/worker.manifest.template azureuser@$VM_IP:/tmp/worker.manifest.template
scp infra/sgx-spike/tee-rex-sgx-worker.service azureuser@$VM_IP:/tmp/tee-rex-sgx-worker.service

# 2. Install on VM
ssh azureuser@$VM_IP "
  sudo cp /tmp/worker.js /app/worker.js
  sudo cp /tmp/worker.manifest.template /app/worker.manifest.template
  sudo cp /tmp/tee-rex-sgx-worker.service /etc/systemd/system/

  # 3. Build + sign Gramine manifest
  cd /app
  sudo gramine-manifest \
    -Dlog_level=error \
    -Darch_libdir=/lib/x86_64-linux-gnu \
    -Dra_type=dcap \
    worker.manifest.template worker.manifest

  sudo gramine-sgx-sign \
    --manifest worker.manifest \
    --output worker.manifest.sgx

  # 4. Start service
  sudo systemctl daemon-reload
  sudo systemctl enable tee-rex-sgx-worker
  sudo systemctl restart tee-rex-sgx-worker
"
```

### Verify the Worker

```bash
# Check service status
ssh azureuser@$VM_IP "sudo systemctl status tee-rex-sgx-worker"

# Check logs
ssh azureuser@$VM_IP "sudo journalctl -u tee-rex-sgx-worker -f"

# Expected output:
# [worker] Generating OpenPGP keypair inside enclave...
# [worker] Keypair generated. Private key stays in enclave.
# [worker] SGX enclave worker listening on 127.0.0.1:5000
# [worker] Actions: get_public_key, get_quote, prove, health
```

## 4. Deploy the Express Server

The Express server runs **outside** SGX (on the same VM) and proxies encrypted requests to the worker.

```bash
ssh azureuser@$VM_IP "
  # Install Bun
  curl -fsSL https://bun.sh/install | bash
  export PATH=\$HOME/.bun/bin:\$PATH

  # Clone or upload server code
  cd /tmp
  # ... (upload packages/server source)

  # Start with SGX mode
  TEE_MODE=sgx PORT=4000 bun run src/index.ts
"
```

For a quick test without a full deploy:
```bash
# Start Express in background on the VM
ssh azureuser@$VM_IP "
  cd /path/to/server
  nohup env TEE_MODE=sgx PORT=4000 \$HOME/.bun/bin/bun run src/index.ts > /tmp/server.log 2>&1 &
"
```

### Verify End-to-End

```bash
# Check attestation endpoint
curl -s http://$VM_IP:4000/attestation | jq '.mode'
# Expected: "sgx"

# Check public key (should be P-256, not curve25519)
curl -s http://$VM_IP:4000/attestation | jq -r '.publicKey' | head -3
# Expected: -----BEGIN PGP PUBLIC KEY BLOCK-----
```

## 5. Gramine Manifest Reference

### worker.manifest.template

The manifest defines the SGX enclave's security boundary:

```toml
# Entrypoint — runs Node.js inside SGX
libos.entrypoint = "/usr/bin/node"
loader.argv = ["node", "/app/worker.js"]

# Environment — hardcoded, not forwarded from host
loader.env.PORT = "5000"
loader.env.HARDWARE_CONCURRENCY = "1"    # Threading doesn't help in SGX
loader.env.MALLOC_ARENA_MAX = "1"        # CRITICAL: prevents glibc heap corruption

# SGX configuration
sgx.debug = false           # No GDB attach, no memory dumps
sgx.enclave_size = "4G"     # Must fit Node.js + bb working set
sgx.max_threads = 32        # Node.js libuv needs threads for event loop
sgx.remote_attestation = "dcap"

# Node.js libuv requires eventfd
sys.insecure__allow_eventfd = true
```

**Trusted files** (measured in MRENCLAVE — changing any file changes the measurement):
- Node.js binary, worker.js, bb binary, node_modules, SSL certificates

**Allowed files** (not measured — can change without affecting MRENCLAVE):
- `/tmp/` — proof workspace (bb writes proof output here)
- `/crs/` — SRS reference string data (read-only in practice)

### Key Configuration Choices

| Setting | Value | Why |
|---------|-------|-----|
| `HARDWARE_CONCURRENCY=1` | Single-threaded bb | Phase 15E showed threading degrades SGX performance |
| `MALLOC_ARENA_MAX=1` | Single glibc arena | Prevents heap corruption in child enclave (2GB arena overhead) |
| `sgx.enclave_size=4G` | 4GB virtual address space | bb uses ~283MB peak; 4G leaves room for Node.js + Gramine |
| `sgx.max_threads=32` | 32 enclave threads | Node.js libuv needs threads for the event loop |
| `sgx.debug=false` | Production mode | Prevents GDB attach and memory inspection |
| P-256 keys (not curve25519) | OpenSSL compatibility | Gramine's OpenSSL build lacks curve25519 support |

## 6. Troubleshooting

### bb crashes with "corrupted size vs. prev_size"

**Cause**: `MALLOC_ARENA_MAX` not set. glibc allocates 64MB per-thread arenas.

**Fix**: Ensure `loader.env.MALLOC_ARENA_MAX = "1"` is in the manifest.

### bb fails with "IVC inputs path" error

**Cause**: bb version mismatch with SDK's `@aztec/bb.js`.

**Fix**: Upload the exact matching binary from `node_modules/.bun/@aztec+bb.js@<VERSION>/`.

### Worker fails to start (AESM errors)

**Cause**: AESM (Attestation Security Engine Manager) service not running.

**Fix**:
```bash
sudo systemctl restart aesmd
sudo systemctl status aesmd
```

### DCAP attestation returns null

**Cause**: Azure DCAP client not configured or `/dev/attestation/` not available.

**Fix**: Verify Gramine version supports DCAP and the VM is a DCdsv3/DCdsv5 instance:
```bash
is-sgx-available
```

### Proof takes too long (>120s)

**Cause**: CloudFront origin timeout is 120s (max without support ticket).

**Fix**: Request a quota increase to 180s via AWS Service Quotas console (`Response timeout per origin`).

### "Invalid argument" (EINVAL) from Gramine

**Cause**: Gramine's `exec()` creates a child enclave for bb. Some syscalls behave differently.

**Fix**: Check Gramine logs with `log_level=trace` in the manifest. Common issues:
- tmpfs mounts not shared between parent/child enclaves (use passthrough mounts)
- glibc arena allocation (set `MALLOC_ARENA_MAX=1`)

## 7. Architecture Decisions

### Why Express outside SGX?

Gramine has a known issue ([#1156](https://github.com/gramineproject/gramine/issues/1156)) where `fork()` in multi-threaded applications causes crashes. Both Bun and Node.js use libuv with multiple threads, making `execFileSync("bb", ...)` unreliable when the Express server itself runs inside SGX.

**Solution**: Run Express outside SGX as a transparent proxy. It never decrypts data — it forwards the encrypted blob to the SGX worker via TCP. The worker (also multi-threaded via Node.js) calls `execFileSync("bb", ...)` which creates a child enclave. With `MALLOC_ARENA_MAX=1`, this works reliably.

### Why TCP (not HTTP) for worker communication?

The SGX worker uses raw TCP with length-prefixed JSON framing because:
1. Simpler than HTTP inside a constrained Gramine environment
2. No HTTP parsing overhead for large binary payloads
3. Length-prefixed framing avoids TCP half-close issues (Bun doesn't support half-close)

### Why Azure MAA instead of raw DCAP verification?

DCAP verification requires:
- Maintaining the PCK certificate cache
- Checking TCB levels against Intel's Provisioning Certification Service
- Verifying Quoting Enclave identity and version

Azure MAA handles all of this and returns a standard JWT. The SDK only needs `jose` for JWT verification — no custom crypto, no certificate chain management.

### Why P-256 instead of curve25519?

Gramine's bundled OpenSSL lacks curve25519 support. The SDK handles this transparently — `openpgp.readKey()` detects the key type and encrypts accordingly.
