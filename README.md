<div align="center">
  <img height="210" src="./assets/tee-rex.jpg" />

  <h1>TEE-Rex</h1>

  <p>
    <strong>A TEE-based prover for Aztec transactions</strong>
  </p>

  [![npm](https://img.shields.io/npm/v/@alejoamiras/tee-rex)](https://www.npmjs.com/package/@alejoamiras/tee-rex)
  [![SDK](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml)
  [![App](https://github.com/alejoamiras/tee-rex/actions/workflows/app.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/app.yml)
  [![Server](https://github.com/alejoamiras/tee-rex/actions/workflows/server.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/server.yml)
  [![Deploy Production](https://github.com/alejoamiras/tee-rex/actions/workflows/deploy-prod.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/deploy-prod.yml)

  **[nextnet.tee-rex.dev](https://nextnet.tee-rex.dev)** · **[devnet.tee-rex.dev](https://devnet.tee-rex.dev)**
</div>

Prove [Aztec](https://aztec.network) transactions inside hardware-isolated Trusted Execution Environments. Supports **two TEE backends** — AWS Nitro Enclaves and Intel SGX (via Gramine) — giving clients a choice of trust roots and cloud providers.

The SDK encrypts proving inputs so that only the enclave can read them, the enclave generates the proof, and returns the public proof to the client.

## Features

- Delegate Aztec transaction proving to a TEE (AWS Nitro Enclave or Intel SGX)
- Encrypt sensitive data with TEE-attested encryption keys (OpenPGP)
- Verify Nitro attestation (COSE_Sign1, certificate chain, PCR values)
- Verify SGX attestation (DCAP quote via Azure MAA, MRENCLAVE/MRSIGNER)
- Drop-in replacement for Aztec's default prover ([SDK docs](packages/sdk/README.md))
- Seamless fallback to local WASM proving
- Use the hosted TEE or run your own

## Quick Start

```sh
npm add @alejoamiras/tee-rex
```

```ts
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createPXE } from "@aztec/pxe/client/lazy";
import { getPXEConfig } from "@aztec/pxe/config";
import { WASMSimulator } from "@aztec/simulator/client";
import { TeeRexProver } from "@alejoamiras/tee-rex";

const prover = new TeeRexProver("https://your-tee-rex-server", new WASMSimulator());
const pxe = await createPXE(node, getPXEConfig(), { proverOrOptions: prover });

// use the PXE as usual -- proving is delegated to the TEE
```

See the [SDK README](packages/sdk/README.md) for the full API reference.

## Architecture

```
tee-rex/
├── packages/
│   ├── sdk/       → @alejoamiras/tee-rex (npm package)
│   │              Drop-in Aztec prover: local/remote/nitro/sgx
│   ├── server/    → Express server (TEE_MODE=standard|nitro|sgx)
│   │              Handles /prove, /attestation endpoints
│   └── app/       → Vite frontend demo (4-mode toggle)
├── infra/
│   ├── tofu/      → OpenTofu IaC (AWS + Azure, single state file)
│   ├── sgx-spike/ → SGX Gramine worker, manifests, deploy scripts
│   └── *.sh       → Nitro deploy scripts, enclave management
└── docs/          → Architecture, SGX deployment, CI pipeline
```

For architecture diagrams and detailed flow descriptions, see [docs/architecture.md](docs/architecture.md).

## Development

```sh
# Install dependencies
bun install

# Run lint + typecheck + unit tests
bun run test

# Run e2e tests (requires Aztec local network + tee-rex server)
bun run test:e2e

# Start the server
bun run start

# Build the SDK
bun run sdk:build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

## Documentation

| Document | Description |
|----------|-------------|
| [SDK README](packages/sdk/README.md) | SDK installation, API reference, usage examples |
| [Architecture](docs/architecture.md) | Dual-TEE system overview, Nitro + SGX data flows, infra layout |
| [How It Works](docs/how-it-works.md) | Attestation protocols, security properties, glossary |
| [SGX Deployment](docs/sgx-deployment.md) | Step-by-step SGX provisioning, manifest reference, troubleshooting |
| [CI Pipeline](docs/ci-pipeline.md) | Workflow reference, change detection, deploy logic |
| [CLAUDE.md](CLAUDE.md) | Full development roadmap and architectural decisions |

## Contributors

Made with ♥️ by alejo · inspired by [nemi.fi](https://github.com/nemi-fi/tee-rex/)
