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

  subgraph Local["Local Machine"]
    Accelerator["TeeRex Accelerator<br/>(Tauri tray app)<br/>bb binary on localhost:59833"]
  end

  CF["CloudFront CDN"]

  subgraph AWS["AWS"]
    S3["S3 Bucket<br/>(Static App)"]

    subgraph EC2["EC2 (c7i.12xlarge, Nitro-capable)"]
      Host["Host Container<br/>(Bun.serve, port 80)<br/>TEE_MODE=nitro<br/>bb download + upload"]
      Socat["socat<br/>TCP:4000 ↔ vsock:16:5000"]
      subgraph Enclave["Nitro Enclave"]
        EnclaveServer["Enclave Service<br/>(Bun.serve, port 4000)<br/>decrypt + prove + attest"]
        NSM["NSM Hardware<br/>(/dev/nsm)"]
        EnclaveServer --> NSM
      end
      Host -->|"http://localhost:4000"| Socat
      Socat --> Enclave
    end
  end

  Client -->|"localhost"| Accelerator
  Client -->|"HTTPS"| CF
  CF -->|"/*"| S3
  CF -->|"/prover/*"| EC2
  CF -->|"/tee/*"| EC2
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

## Accelerated Proving Flow

When the SDK is set to `ProvingMode.accelerated`, it routes proving to the native TeeRex Accelerator running on the user's machine — bypassing browser WASM throttling.

```mermaid
sequenceDiagram
  participant C as Client (SDK)
  participant A as Accelerator (localhost:59833)
  participant BB as bb binary (native)

  C->>A: GET /health
  A-->>C: { status, aztec_version, available_versions, bb }

  Note over C: Check version compatibility<br/>Fall back to WASM on mismatch

  C->>A: POST /prove (msgpack body, x-aztec-version header)

  A->>BB: bb prove --scheme chonk (temp files)
  BB-->>A: proof bytes

  A-->>C: { proof: "<base64>" }<br/>x-prove-duration-ms header

  Note over C: Emit "proved" phase with timing<br/>Deserialize proof<br/>Return to PXE
```

If the accelerator is unavailable or returns a version mismatch, the SDK emits a `"fallback"` phase and proves via WASM instead.

## SDK Phase Lifecycle

The SDK emits phase callbacks during proof generation for UI animation and timing. All modes follow the same pattern, ending with a `"proved"` phase that carries the actual proving duration:

| Phase | Description | Emitted by |
|-------|-------------|------------|
| `detect` | Checking accelerator availability | Accelerated |
| `serialize` | Serializing witness data (msgpack) | UEE, Accelerated |
| `fetch-attestation` | Fetching enclave attestation document | UEE/TEE |
| `encrypt` | Encrypting payload with enclave public key | UEE/TEE |
| `transmit` | Sending payload to server | UEE, Accelerated |
| `proving` | Proof generation in progress | All modes |
| `proved` | Proof complete — carries `{ durationMs }` | All modes |
| `receive` | Deserializing proof response | All modes |
| `fallback` | Accelerator unavailable, falling back to WASM | Accelerated |
| `downloading` | Accelerator downloading bb for new version | Accelerated |

The `"proved"` phase timing comes from:
- **WASM**: `performance.now()` around the local proof call
- **UEE/TEE**: `x-prove-duration-ms` response header from the server
- **Accelerated**: `x-prove-duration-ms` response header from the accelerator

## Package Structure

```
tee-rex/
├── packages/
│   ├── sdk/          → @alejoamiras/tee-rex (npm package)
│   │                   Drop-in Aztec prover: local (WASM), UEE (TEE), or accelerated (native)
│   ├── server/       → Two entry points: host (Bun.serve, src/index.ts) + enclave (Bun.serve, src/enclave.ts)
│   │                   Host: /prove, /attestation, /health, /encryption-public-key (proxies to enclave in nitro mode)
│   │                   Enclave: /upload-bb, /prove, /attestation, /public-key, /health
│   ├── app/          → Vite frontend demo (local/UEE/TEE mode toggle)
│   └── accelerator/  → Tauri tray app — native proving on localhost:59833
│                       Runs bb binary natively, auto-detected by SDK
├── infra/            → Deploy scripts, IAM policies, CloudFront config
└── docs/             → Architecture, CI pipeline, Nitro deployment guide
```

## Docker Image Strategy

```mermaid
graph LR
  Base["Dockerfile.base<br/>(Bun + system deps + bun install)<br/>~2.4 GB, tagged per Aztec version"]
  Host["Dockerfile (host)<br/>(FROM base, copy source + build)<br/>TEE_MODE=nitro, proxies to enclave<br/>~50 MB delta"]
  Nitro["Dockerfile.nitro (enclave)<br/>(FROM rust: build libnsm.so<br/>FROM base: copy source + CRS + build)<br/>Bun.serve on port 4000<br/>No bb baked — uploaded at runtime"]

  Base --> Host
  Base --> Nitro
```

For the full attestation and encryption details, see [How It Works](./how-it-works.md).
