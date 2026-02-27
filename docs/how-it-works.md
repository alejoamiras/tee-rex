# TEE-Rex: Delegated Proving for Aztec via Trusted Execution Environments

## The Problem

Aztec is a privacy-preserving L2 on Ethereum. When you make a transaction, your client (the PXE — Private eXecution Environment) needs to generate a **zero-knowledge proof** that the transaction is valid, without revealing any private data.

This proof generation is **expensive**. It involves running a circuit prover (Barretenberg) over your transaction's witness data, which can take significant time and CPU. On mobile or low-power devices, this is a bottleneck.

The naive solution is to send your transaction data to a remote prover. But that **breaks privacy** — the prover sees your witnesses, bytecode, and other sensitive details.

## The Solution: Prove Inside a TEE

A **Trusted Execution Environment (TEE)** is a hardware-isolated enclave that runs code in a way where:

1. **Nobody can see what's inside** — not the OS, not the cloud provider, not even someone with physical access to the machine
2. **Nobody can tamper with the code** — the enclave runs exactly the code it was built with
3. **It can prove what it's running** — the hardware generates a cryptographic attestation document signed by the chip manufacturer

TEE-Rex supports **two TEE backends** — AWS Nitro Enclaves and Intel SGX (via Gramine) — providing a choice of trust roots and cloud providers. The idea:

- The client encrypts its proving inputs with a key that only the enclave holds
- The enclave decrypts, generates the proof, and returns it
- The proof itself is not encrypted (it's public — it gets posted on-chain)
- The client can **verify** the enclave is genuine by checking the attestation document

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Aztec PXE + TEE-Rex SDK)                           │
│                                                             │
│  1. Build transaction locally (private execution)           │
│  2. GET /attestation → verify enclave is genuine            │
│  3. Encrypt proving inputs with enclave's public key        │
│  4. POST /prove → get back the proof                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  EC2 Host                                                   │
│  socat TCP:4000 ←→ vsock:16:5000                            │
└──────────────────────────┬──────────────────────────────────┘
                           │ vsock (hypervisor-controlled)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  AWS Nitro Enclave                                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  TEE-Rex Server (Express + Barretenberg)            │    │
│  │                                                     │    │
│  │  • Decrypt proving inputs (OpenPGP)                 │    │
│  │  • Run Barretenberg prover (native binary)          │    │
│  │  • Return proof (not encrypted, proofs are public)  │    │
│  │  • Generate attestation via NSM hardware (/dev/nsm) │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  No network, no disk, no SSH. Only vsock in/out.            │
└─────────────────────────────────────────────────────────────┘
```

## What Happens Step by Step

### 1. Client Fetches Attestation

```
GET /attestation
```

The server generates a **Nitro attestation document** — a COSE_Sign1-signed blob produced by the Nitro Security Module (NSM) hardware. This document contains:

- **PCR values** (Platform Configuration Registers) — cryptographic hashes of the enclave's code, kernel, and configuration. If anyone changes a single byte of the code, the PCRs change.
- **A certificate chain** rooted at AWS's Nitro Root CA — proves this is a real Nitro Enclave, not someone pretending to be one.
- **The enclave's encryption public key** — embedded in the attestation so you know the key genuinely belongs to this enclave.
- **A timestamp** — proves the document is fresh, not a replay.

The server calls `libnsm.so` via Bun FFI to talk to the NSM device (`/dev/nsm`) and generate this document.

### 2. Client Verifies the Attestation

The SDK verifies the attestation document:

1. **Decode COSE_Sign1 envelope** (CBOR-encoded signed structure)
2. **Build the certificate chain**: Leaf cert → intermediate CAs → AWS Nitro Root CA
3. **Verify each signature** in the chain (ECDSA P-384)
4. **Check PCR values** match expected values (optional — pin to a specific code version)
5. **Check freshness** — reject if document is older than 5 minutes
6. **Extract the public key** — this is the key we'll encrypt with

If any check fails, the SDK refuses to send data.

### 3. Client Encrypts and Sends Proving Inputs

The SDK serializes the execution steps (function name, witness, bytecode, verification key) and encrypts them using **OpenPGP** with the enclave's public key:

```
POST /prove
{ "data": "<base64-encrypted-payload>" }
```

Only the enclave can decrypt this — it holds the corresponding private key, which was generated inside the enclave and never leaves it.

### 4. Enclave Generates the Proof

Inside the enclave:

1. **Decrypt** the payload using the private key
2. **Deserialize** the execution steps
3. **Run Barretenberg** (native binary) to generate a ClientIVC proof
4. **Return the proof** as base64 JSON

The proof is not encrypted because zero-knowledge proofs are designed to be public — they prove a statement is true without revealing the private inputs.

### 5. Client Uses the Proof

The SDK deserializes the proof into Aztec's `ChonkProofWithPublicInputs` format and returns it to the PXE, which includes it in the transaction.

## What Makes Nitro Enclaves Special

AWS Nitro Enclaves are not regular VMs or containers. They are:

- **Isolated virtual machines** created by the Nitro Hypervisor (not the OS)
- **No persistent storage** — everything is in memory
- **No network interfaces** — the only way in or out is `vsock`, a hypervisor-controlled virtual socket
- **No SSH, no shell** — you cannot log into a running enclave
- **Measured boot** — every component (kernel, ramdisk, application) is hashed into PCR registers before execution
- **Hardware attestation** — the NSM device produces signed attestation documents that chain to AWS's root of trust

This means:
- AWS operators cannot see inside the enclave
- The EC2 instance owner cannot see inside the enclave
- The code running inside is cryptographically verified

## What Makes Intel SGX Different

Intel SGX (Software Guard Extensions) takes a different approach from Nitro. Instead of an isolated VM, SGX creates an **encrypted memory region** (enclave) within a regular process. The CPU encrypts enclave memory with a hardware key — even a physical memory dump reveals nothing.

TEE-Rex runs the SGX enclave via [Gramine](https://gramineproject.io/), a library OS that lets unmodified Linux applications (Node.js, bb) run inside SGX without code changes.

Key properties:
- **Encrypted memory** — the CPU transparently encrypts/decrypts enclave pages. The OS, hypervisor, and hardware attacks cannot read enclave memory.
- **Code measurement** — MRENCLAVE (hash of enclave code) and MRSIGNER (hash of signing key) uniquely identify what's running.
- **DCAP attestation** — the enclave generates a quote signed by the CPU, verified via Intel Trust Authority (ITA).
- **No VM overhead** — the enclave runs as a process on the host, not a separate VM. But Gramine adds its own overhead (~5x for memory-intensive workloads).

TEE-Rex's SGX architecture splits the work:
- **Express server** (outside SGX) — receives HTTPS requests, forwards encrypted blobs to the worker. Never sees plaintext.
- **Gramine worker** (inside SGX) — holds the private key, decrypts, runs `bb prove`, returns the proof.

This design avoids the Gramine `fork()` bug that crashes multi-threaded Node.js.

## The SDK: `@alejoamiras/tee-rex`

The SDK (`TeeRexProver`) is a drop-in replacement for Aztec's local prover. It extends `BBLazyPrivateKernelProver` and overrides the `createChonkProof()` method.

```typescript
import { TeeRexProver } from "@alejoamiras/tee-rex";

const prover = new TeeRexProver("https://tee-rex.example.com", wasmSimulator);

// Switch between local (WASM) and remote (TEE) proving
prover.setProvingMode("remote");

// Optionally require Nitro attestation verification
prover.setAttestationConfig({
  requireAttestation: true,
  expectedPCRs: {
    0: "8ea65149c7369a...", // Hash of enclave image
  },
  maxAgeMs: 300_000, // 5 minutes
});

// Or SGX attestation verification
prover.setAttestationConfig({
  requireAttestation: true,
  expectedMrEnclave: "398bdbd5122052...", // Hash of enclave code
  expectedMrSigner: "a1b2c3d4e5f6...",   // Hash of signing key
});

// Use it like any other Aztec prover — the SDK handles
// encryption, attestation, and remote communication transparently
const proof = await prover.createChonkProof(executionSteps);
```

Two modes:
- **`"local"`** — proves using WASM Barretenberg locally (default, always works)
- **`"remote"`** — encrypts and delegates to the TEE server (Nitro or SGX, auto-detected from `/attestation` response)

## The Docker Image: Multi-Stage Build (Nitro)

The `Dockerfile.nitro` uses three stages:

| Stage | Base Image | Purpose |
|-------|-----------|---------|
| 1. `nsm` | `rust:1.85-slim` | Compiles `libnsm.so` from AWS's `aws-nitro-enclaves-nsm-api` Rust crate |
| 2. `builder` | `oven/bun:1.3-debian` | Installs dependencies, copies source code |
| 3. Runtime | `oven/bun:1.3-debian` | Copies `libnsm.so` + app, runs server with socat vsock bridge |

The `libnsm.so` library is what lets the server talk to the NSM hardware device. It must be compiled from source — there is no pre-built package.

The SGX backend doesn't use Docker — it runs directly on the Alibaba Cloud ECS VM inside Gramine. See the [SGX Deployment Guide](./sgx-deployment.md) for details.

## Security Properties

| Property | Nitro | SGX |
|----------|-------|-----|
| **Confidentiality** | OpenPGP curve25519 encryption | OpenPGP P-256 encryption |
| **Authenticity** | COSE_Sign1 → AWS Nitro Root CA | DCAP quote → Intel ITA JWT |
| **Integrity** | PCR0/1/2 hash all enclave code | MRENCLAVE hashes all enclave code |
| **Freshness** | Attestation timestamp < 5 min | ITA JWT `iat` claim < 5 min |
| **Isolation** | No network, no disk (vsock only) | Encrypted memory (loopback TCP) |
| **Non-extractability** | Key in enclave memory only | Key in enclave memory only |

## What's NOT Encrypted

- **The proof itself** — ZK proofs are public by design (they go on-chain)
- **The attestation document / quote** — it's meant to be verified by anyone
- **The public key** — it's, well, public

## Glossary

| Term | Meaning |
|------|---------|
| **TEE** | Trusted Execution Environment — hardware-isolated secure enclave |
| **Nitro Enclave** | AWS's TEE implementation, based on the Nitro Hypervisor |
| **SGX** | Intel Software Guard Extensions — CPU-level encrypted memory enclaves |
| **Gramine** | Library OS that runs unmodified Linux apps inside SGX enclaves |
| **NSM** | Nitro Security Module — hardware device inside the enclave that generates attestation |
| **DCAP** | Data Center Attestation Primitives — Intel's attestation framework for SGX |
| **ITA** | Intel Trust Authority — cloud-agnostic service that verifies SGX DCAP quotes and returns JWTs |
| **PCR** | Platform Configuration Register — hash measurement of Nitro enclave contents |
| **MRENCLAVE** | Measurement of SGX enclave code (analogous to Nitro PCR0) |
| **MRSIGNER** | Hash of the SGX enclave signing key |
| **EPC** | Enclave Page Cache — hardware-encrypted memory available to SGX enclaves |
| **COSE_Sign1** | CBOR Object Signing format — how Nitro attestation documents are signed |
| **vsock** | Virtual socket — the only communication channel into/out of a Nitro Enclave |
| **libnsm.so** | Shared library for calling the NSM device via FFI |
| **Barretenberg** | Aztec's proving backend — generates zero-knowledge proofs |
| **ClientIVC** | Client Iterative Verifiable Computing — Aztec's proof system |
| **PXE** | Private eXecution Environment — Aztec's client-side execution engine |
| **Chonk Proof** | The output format of Aztec's client prover |
| **OpenPGP** | Encryption standard (RFC 4880) used for key exchange and payload encryption |
| **EIF** | Enclave Image File — the packaged enclave image that Nitro boots |
