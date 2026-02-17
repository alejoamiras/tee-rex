# Architecture

## System Overview

TEE-Rex is a delegated proving service for [Aztec](https://aztec.network/) that runs inside an AWS Nitro Enclave. The SDK encrypts proving inputs so that only the enclave can read them, generates the proof inside the TEE, and returns the public proof to the client.

```mermaid
graph TB
  subgraph Client["Client (Browser / Node.js)"]
    PXE["Aztec PXE"]
    SDK["@alejoamiras/tee-rex SDK"]
    PXE --> SDK
  end

  CF["CloudFront CDN"]

  subgraph AWS["AWS"]
    S3["S3 Bucket<br/>(Static App)"]

    subgraph ProverEC2["Prover EC2"]
      ProverServer["TEE-Rex Server<br/>(Express + Barretenberg)"]
    end

    subgraph TeeEC2["TEE EC2 (Nitro-capable)"]
      Socat["socat<br/>TCP:4000 ↔ vsock:16:5000"]
      subgraph Enclave["Nitro Enclave"]
        TeeServer["TEE-Rex Server<br/>(Express + Barretenberg)"]
        NSM["NSM Hardware<br/>(/dev/nsm)"]
        TeeServer --> NSM
      end
      Socat --> Enclave
    end
  end

  Client -->|"HTTPS"| CF
  CF -->|"/*"| S3
  CF -->|"/prover/*"| ProverEC2
  CF -->|"/tee/*"| TeeEC2
```

## Proving Flow

```mermaid
sequenceDiagram
  participant C as Client (SDK)
  participant S as TEE-Rex Server

  C->>S: GET /attestation
  S-->>C: Nitro attestation document + public key

  Note over C: Verify COSE_Sign1 signature<br/>Check certificate chain → AWS Root CA<br/>Validate PCRs, freshness, nonce

  C->>C: Encrypt proving inputs with enclave public key (OpenPGP)

  C->>S: POST /prove { data: "<encrypted>" }

  Note over S: Decrypt with enclave private key<br/>Run Barretenberg prover<br/>Generate ClientIVC proof

  S-->>C: { proof: "<base64>" }

  Note over C: Deserialize proof<br/>Return to PXE for transaction submission
```

## Package Structure

```
tee-rex/
├── packages/
│   ├── sdk/       → @alejoamiras/tee-rex (npm package)
│   │              Drop-in Aztec prover: local (WASM) or remote (TEE)
│   ├── server/    → Express server (runs in Nitro Enclave or standalone)
│   │              Handles /prove, /attestation, /encryption-public-key
│   └── app/       → Vite frontend demo (local/remote/TEE mode toggle)
├── infra/         → Deploy scripts, IAM policies, CloudFront config
└── docs/          → Architecture, CI pipeline, Nitro deployment guide
```

## Docker Image Strategy

```mermaid
graph LR
  Base["Dockerfile.base<br/>(Bun + system deps + bun install)<br/>~2.4 GB, tagged per Aztec version"]
  Prover["Dockerfile<br/>(FROM base, copy source + build)<br/>~50 MB delta"]
  Nitro["Dockerfile.nitro<br/>(FROM rust: build libnsm.so<br/>FROM base: copy source + build)<br/>Converted to EIF by nitro-cli"]

  Base --> Prover
  Base --> Nitro
```

For the full attestation and encryption details, see [How It Works](./how-it-works.md).
