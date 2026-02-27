# Architecture

## System Overview

TEE-Rex is a delegated proving service for [Aztec](https://aztec.network/) that runs zero-knowledge proof generation inside hardware-isolated Trusted Execution Environments (TEEs). It supports **two independent TEE backends** — AWS Nitro Enclaves and Intel SGX via Gramine — giving clients a choice of trust roots and cloud providers.

The SDK encrypts proving inputs so that only the enclave can read them, the enclave generates the proof, and returns the public proof to the client. The proof itself is not encrypted — it's public data that gets posted on-chain.

```
                          ┌──────────────────────────────────────────┐
                          │         Client (Browser / Node.js)       │
                          │                                          │
                          │  Aztec PXE ──► @alejoamiras/tee-rex SDK  │
                          │                                          │
                          │  1. GET /attestation → verify enclave    │
                          │  2. Encrypt inputs with enclave's key    │
                          │  3. POST /prove → get back proof         │
                          └──────────────────┬───────────────────────┘
                                             │ HTTPS
                                             ▼
                          ┌──────────────────────────────────────────┐
                          │           CloudFront CDN                 │
                          │                                          │
                          │  /*           → S3 (static Vite app)     │
                          │  /prover/*    → Prover EC2 (standard)    │
                          │  /tee/*       → TEE EC2 (Nitro Enclave)  │
                          │  /sgx/*       → SGX VM (Intel SGX)       │
                          └───────┬──────────┬──────────┬────────────┘
                                  │          │          │
              ┌───────────────────┘          │          └───────────────────┐
              ▼                              ▼                              ▼
┌──────────────────────┐  ┌────────────────────────────────┐  ┌────────────────────────────────┐
│   Prover EC2 (AWS)   │  │     TEE EC2 (AWS Nitro)        │  │     SGX VM (Alibaba g7t)      │
│                      │  │                                │  │                                │
│  Express + bb (WASM) │  │  socat TCP:4000↔vsock:16:5K    │  │  Express (outside SGX)         │
│  No attestation      │  │  ┌──────────────────────────┐  │  │  ┌──────────────────────────┐  │
│  Standard mode       │  │  │  Nitro Enclave           │  │  │  │  Gramine SGX Enclave     │  │
│                      │  │  │                          │  │  │  │                          │  │
│                      │  │  │  Express + bb (WASM)     │  │  │  │  Node.js worker.js       │  │
│                      │  │  │  NSM hardware (/dev/nsm) │  │  │  │  bb binary (native)      │  │
│                      │  │  │  curve25519 keys         │  │  │  │  DCAP (/dev/attestation)  │  │
│                      │  │  └──────────────────────────┘  │  │  │  P-256 keys               │  │
│                      │  │  No network, no disk, no SSH   │  │  └──────────────────────────┘  │
│                      │  │                                │  │  TCP:5000 (loopback only)      │
└──────────────────────┘  └────────────────────────────────┘  └────────────────────────────────┘
```

## Four Proving Modes

| Mode | Where proof runs | Attestation | Trust model |
|------|-----------------|-------------|-------------|
| **Local** | Browser (WASM) | None | Client trusts itself |
| **Remote** | Prover EC2 | None | Client trusts server operator |
| **Nitro** | AWS Nitro Enclave | COSE_Sign1 → AWS Root CA | Client trusts AWS hardware |
| **SGX** | Intel SGX via Gramine | DCAP → ITA JWT | Client trusts Intel hardware |

## Nitro Enclave Architecture

The Nitro Enclave is a hardware-isolated VM created by the Nitro Hypervisor. It has **no network, no disk, no SSH** — the only way in or out is `vsock`, a hypervisor-controlled virtual socket.

```
EC2 Host (m5.xlarge)
├── socat TCP:4000 ↔ vsock:16:5000    (systemd: tee-rex-proxy.service)
└── Nitro Enclave                       (systemd: tee-rex-enclave.service)
    ├── Express server (port 5000 on vsock)
    ├── Barretenberg prover (WASM)
    ├── OpenPGP encryption (curve25519)
    └── NSM hardware (/dev/nsm → attestation documents)
```

**Data flow**:
1. CloudFront routes `/tee/*` to EC2 port 4000 (strips path prefix)
2. socat bridges TCP:4000 to vsock:16:5000
3. Express inside the enclave handles the request
4. Decrypts with enclave-generated curve25519 private key
5. Deserializes execution steps, runs Barretenberg WASM prover
6. Returns proof (public, unencrypted)

**Attestation**: The Nitro Security Module (`/dev/nsm`) generates COSE_Sign1-signed attestation documents containing PCR measurements and the enclave's public key. The SDK verifies the certificate chain to AWS's Nitro Root CA.

## SGX Enclave Architecture

Intel SGX uses a fundamentally different approach. Instead of a full VM, SGX creates an encrypted memory region (enclave) within a regular process. [Gramine](https://gramineproject.io/) provides a library OS that runs unmodified Linux applications inside SGX enclaves.

```
Alibaba ECS (ecs.g7t.xlarge — 4 vCPU, 16GB RAM, 8GB EPC)
│
├── Express server (Bun, port 4000)          ← runs OUTSIDE SGX
│   TEE_MODE=sgx, routes to SGX worker
│   NEVER decrypts — forwards encrypted blob as-is
│
└── Gramine SGX Worker (port 5000, loopback) ← runs INSIDE SGX
    ├── Node.js + worker.js
    ├── OpenPGP keypair (P-256, generated inside enclave)
    ├── bb binary (native amd64, runs via execFileSync)
    ├── DCAP attestation (/dev/attestation/quote)
    └── CRS files (/crs — bn254_g1.dat, bn254_g2.dat, grumpkin_g1.dat)
```

**Key design choice**: The Express server runs **outside** the enclave and acts as a dumb proxy. It never sees plaintext. This avoids the Gramine fork() bug ([#1156](https://github.com/gramineproject/gramine/issues/1156)) that would crash multi-threaded Node.js/Bun in an enclave. The Express server forwards the encrypted blob via TCP to the worker, which does all sensitive work inside SGX.

**Data flow**:
1. Client → Express server: `POST /prove { data: "<encrypted>" }`
2. Express → SGX worker (TCP, length-prefixed JSON): `{ action: "prove", encryptedPayload: "<base64>" }`
3. Inside SGX: decrypt with P-256 private key → write msgpack to `/tmp` → `bb prove --scheme chonk` → read proof
4. SGX worker → Express: `{ proof: "<base64>" }`
5. Express → Client: `{ proof: "<base64>" }`

**The server never sees plaintext.** The encrypted blob goes straight from client to enclave. Only the proof (public data) comes back out.

### SGX vs Nitro: Key Differences

| Property | Nitro Enclave | SGX Enclave |
|----------|--------------|-------------|
| **Isolation** | Full VM (no network, no disk, no SSH) | Encrypted memory region within a process |
| **Attestation** | COSE_Sign1 → AWS Root CA (local verification) | DCAP quote → Intel Trust Authority (ITA) JWT (remote verification) |
| **Communication** | vsock (hypervisor-controlled) | TCP over loopback (same VM) |
| **Key type** | curve25519 (OpenPGP) | P-256 (OpenPGP) — Gramine's OpenSSL lacks curve25519 |
| **Prover** | Barretenberg WASM (inside enclave) | bb native binary (inside enclave via execFileSync) |
| **Cloud** | AWS (m5.xlarge, ~$0.19/hr) | Alibaba (g7t.xlarge) |
| **Memory** | 8GB hugepages (configurable) | 8GB EPC (hardware, non-configurable) |
| **Proof time** | ~11s | ~52s (Gramine overhead) |

### SGX: Why MALLOC_ARENA_MAX=1 Matters

glibc allocates a 64MB per-thread malloc arena by default. With `sgx.max_threads=32`, the child enclave (where bb runs via `execFileSync`) could allocate up to 2GB just for arena metadata — competing with bb's 283MB working set inside the 4GB enclave. This caused deterministic heap corruption ("corrupted size vs. prev_size") at the 4th circuit.

`MALLOC_ARENA_MAX=1` forces all threads to share a single arena, eliminating the corruption. Since bb runs single-threaded (`HARDWARE_CONCURRENCY=1`), there's no performance penalty.

**Rule**: Always set `MALLOC_ARENA_MAX=1` in Gramine manifests for memory-intensive workloads.

### SGX: Gramine Manifest Architecture

Two manifest templates define what runs inside SGX:

**`worker.manifest.template`** — The main enclave (Node.js + worker.js):
- Entrypoint: `/usr/bin/node` running `/app/worker.js`
- 4GB enclave, 32 threads (for Node.js libuv thread pool)
- Mounts: `/app` (code), `/crs` (SRS data), `/tmp` (proof workspace), `/etc` (TLS certs)
- Trusted files: node, worker.js, bb binary, node_modules, SSL certificates
- Allowed files: `/tmp/` (proof I/O), `/crs/` (read-only SRS data)
- `sys.insecure__allow_eventfd = true` (required by Node.js libuv)

**`bb.manifest.template`** — Standalone bb (for future use):
- Entrypoint: `/app/bb` with `loader.insecure__use_cmdline_argv = true`
- 2GB enclave, 4 threads (bb is single-threaded for SGX)
- Hardened: `sgx.debug = false`, no host env forwarding

### SGX: Attestation Protocol

```
Client (SDK)                Intel Trust Authority (ITA)               SGX Enclave
────────────                ─────────               ───────────

1. GET /attestation ──────────────────────────────► get_public_key
                                                    get_quote(SHA256(pubkey))
   ◄────────────────────────────────────────────── { quote, publicKey }

2. POST quote to ITA ────► Verify DCAP quote
                            Check PCK cert chain
                            Check TCB level
                            Check QE identity
                            Sign JWT with claims
   ◄────────────────────── JWT token

3. Verify JWT signature
   against ITA JWKS keys

4. Check sgx_mrenclave
   Check sgx_mrsigner
   Check sgx_report_data
   == SHA256(publicKey)

5. Encrypt payload with
   verified public key
   POST /prove ──────────────────────────────────► Decrypt, prove, return
```

**Why Intel Trust Authority (ITA) instead of raw DCAP?** DCAP verification requires maintaining the PCK certificate cache, checking TCB levels against Intel's PCS, and verifying the Quoting Enclave identity. Intel Trust Authority (ITA) handles all of this and returns a simple JWT that the SDK can verify with standard `jose` libraries.

## Package Structure

```
tee-rex/
├── packages/
│   ├── sdk/         → @alejoamiras/tee-rex (npm)
│   │                  Drop-in Aztec prover: local/remote/nitro/sgx
│   │                  Verifies Nitro (COSE_Sign1) and SGX (DCAP via ITA)
│   ├── server/      → Express server
│   │                  TEE_MODE=standard|nitro|sgx
│   │                  SGX mode: dumb proxy to Gramine worker
│   └── app/         → Vite frontend (4-mode toggle: local/remote/nitro/sgx)
├── infra/
│   ├── tofu/        → OpenTofu IaC (AWS + Alibaba Cloud, single state file)
│   ├── sgx-spike/   → SGX Gramine worker, manifests, deploy script, systemd
│   ├── cloudfront/  → CloudFront + S3 configuration docs
│   ├── iam/         → IAM policy templates
│   └── *.sh         → Nitro deploy scripts, enclave management
└── docs/            → Architecture, how-it-works, CI pipeline, SGX deployment
```

## Infrastructure

### OpenTofu (IaC)

Single state file in S3 (`tee-rex-tofu-state`, eu-west-2) manages all environments:

| Resource | CI | Prod | Devnet |
|----------|:--:|:----:|:------:|
| TEE EC2 (m5.xlarge, Nitro) | 1 | 1 | 1 |
| Prover EC2 (t3.xlarge) | 1 | 1 | 1 |
| Elastic IPs | - | 2 | 2 |
| S3 bucket (app) | - | 1 | 1 |
| CloudFront distribution | - | 1 | 1 |
| ECR repository | 1 (shared) |||
| IAM (OIDC + roles) | 1 (shared) |||
| **Alibaba SGX VM** (g7t.xlarge) | 1 | 1 | 1 |

### CloudFront Routing

```
nextnet.tee-rex.dev (prod)            devnet.tee-rex.dev
├── /*         → S3 bucket             ├── /*         → S3 bucket
├── /prover/*  → Prover EC2:80         ├── /prover/*  → Prover EC2:80
├── /tee/*     → TEE EC2:4000          ├── /tee/*     → TEE EC2:4000
└── /sgx/*     → SGX VM:4000           └── /sgx/*     → SGX VM:4000
```

CloudFront Functions strip the path prefix at viewer-request (`/prover/prove` → `/prove`).

### Docker Image Strategy

```
Dockerfile.base (Bun + system deps + bun install)    ~2.4 GB, tagged per Aztec version
├── Dockerfile       (FROM base, copy source + build) ~50 MB delta → Prover EC2
└── Dockerfile.nitro (FROM rust: build libnsm.so
                      FROM base: copy source + build) Converted to EIF by nitro-cli
```

### SGX Deployment (Alibaba Cloud)

No Docker — the SGX worker runs directly on the VM inside Gramine:

```
Alibaba ECS (g7t.xlarge)
├── /app/worker.js               ← SGX worker source
├── /app/worker.manifest.sgx     ← Signed Gramine manifest
├── /app/bb                      ← Barretenberg native binary (must match @aztec/bb.js version)
├── /app/node_modules/            ← openpgp dependency
├── /crs/                         ← Aztec SRS files (bn254_g1.dat, bn254_g2.dat, grumpkin_g1.dat)
└── systemd services:
    └── tee-rex-sgx-worker.service  → gramine-sgx worker (port 5000)
```

For step-by-step provisioning, see [SGX Deployment Guide](./sgx-deployment.md).

## Security Properties

| Property | Nitro | SGX | Standard |
|----------|:-----:|:---:|:--------:|
| **Confidentiality** (inputs encrypted) | OpenPGP curve25519 | OpenPGP P-256 | OpenPGP curve25519 |
| **Hardware attestation** | COSE_Sign1 → AWS Root CA | DCAP → Intel Trust Authority (ITA) | None |
| **Code integrity** (measured boot) | PCR0/1/2 | MRENCLAVE/MRSIGNER | None |
| **Key non-extractability** | Key in enclave memory only | Key in enclave memory only | Key in process memory |
| **Network isolation** | No network (vsock only) | Loopback TCP (same VM) | Standard networking |
| **Disk isolation** | No persistent storage | `/tmp` passthrough (host-visible) | Standard filesystem |

**SGX caveat**: The `/tmp` passthrough mount means proof workspace files are visible to the host OS. This is acceptable for the spike (proof data is public anyway) but production should use encrypted tmpfs or in-memory buffers.
