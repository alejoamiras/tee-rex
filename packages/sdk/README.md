# @alejoamiras/tee-rex

Delegate [Aztec](https://aztec.network) transaction proving to a Trusted Execution Environment.

[![npm](https://img.shields.io/npm/v/@alejoamiras/tee-rex)](https://www.npmjs.com/package/@alejoamiras/tee-rex)
[![SDK](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml)

## Installation

```sh
npm add @alejoamiras/tee-rex
```

## Quick Start

Drop `TeeRexProver` into your PXE as a custom prover:

```ts
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createPXE } from "@aztec/pxe/client/lazy";
import { getPXEConfig } from "@aztec/pxe/config";
import { WASMSimulator } from "@aztec/simulator/client";
import { TeeRexProver, ProvingMode } from "@alejoamiras/tee-rex";

const TEE_REX_API = "http://localhost:4000";
const node = createAztecNodeClient("<aztec-node-rpc-url>");

const prover = new TeeRexProver(TEE_REX_API, new WASMSimulator());
const pxe = await createPXE(node, getPXEConfig(), {
  proverOrOptions: prover,
});

// use the PXE as usual — proving is delegated to the TEE
```

### Switch proving modes

```ts
import { ProvingMode } from "@alejoamiras/tee-rex";

// delegate proving to a remote TEE (default)
prover.setProvingMode(ProvingMode.remote);

// or prove locally in WASM (fallback)
prover.setProvingMode(ProvingMode.local);
```

### Configure attestation verification

```ts
prover.setAttestationConfig({
  // reject servers not running in a TEE
  requireAttestation: true,
  // verify enclave identity via PCR values
  expectedPCRs: { 0: "abc123..." },
  // attestation freshness (default: 5 minutes)
  maxAgeMs: 5 * 60 * 1000,
});
```

## API

### `TeeRexProver`

Aztec private kernel prover that can generate proofs locally or on a remote
tee-rex server running inside an AWS Nitro Enclave.

```ts
class TeeRexProver extends BBLazyPrivateKernelProver {
  constructor(apiUrl: string, ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>)
  setProvingMode(mode: ProvingMode): void
  setApiUrl(url: string): void
  setAttestationConfig(config: TeeRexAttestationConfig): void
  createChonkProof(executionSteps: PrivateExecutionStep[]): Promise<ChonkProofWithPublicInputs>
}
```

- **`apiUrl`** — TEE-Rex server endpoint (e.g. `http://localhost:4000`)
- **`...args`** — forwarded to `BBLazyPrivateKernelProver` (typically a `CircuitSimulator` instance)
- **`setProvingMode(mode)`** — switch between `"remote"` (TEE) and `"local"` (WASM) proving
- **`setApiUrl(url)`** — update the tee-rex server URL at runtime
- **`setAttestationConfig(config)`** — configure attestation verification (PCR checks, freshness, require TEE)
- **`createChonkProof(steps)`** — overrides the parent to route proofs through the TEE server in remote mode

### `ProvingMode`

```ts
const ProvingMode = { local: "local", remote: "remote" } as const;
type ProvingMode = "local" | "remote";
```

### `TeeRexAttestationConfig`

```ts
interface TeeRexAttestationConfig {
  requireAttestation?: boolean;  // reject servers in standard (non-TEE) mode
  expectedPCRs?: Record<number, string>;  // expected PCR values (hex strings)
  maxAgeMs?: number;  // max attestation age in ms (default: 5 min)
}
```

### `verifyNitroAttestation`

Verify a Nitro attestation document and extract the embedded public key. Used internally by `TeeRexProver` but exported for advanced use cases.

```ts
function verifyNitroAttestation(
  attestationDocumentBase64: string,
  options?: AttestationVerifyOptions,
): Promise<{ publicKey: string; document: NitroAttestationDocument }>
```

### `AttestationError`

Error thrown when attestation verification fails. Includes a machine-readable `code` for programmatic handling.

```ts
class AttestationError extends Error {
  readonly code: AttestationErrorCode;
}

const AttestationErrorCode = {
  INVALID_COSE: "INVALID_COSE",
  INVALID_DOCUMENT: "INVALID_DOCUMENT",
  CHAIN_FAILED: "CHAIN_FAILED",
  SIGNATURE_FAILED: "SIGNATURE_FAILED",
  EXPIRED: "EXPIRED",
  PCR_MISMATCH: "PCR_MISMATCH",
  NONCE_MISMATCH: "NONCE_MISMATCH",
  MISSING_KEY: "MISSING_KEY",
} as const;
```

## How It Works

`TeeRexProver` extends Aztec's `BBLazyPrivateKernelProver` and overrides `createChonkProof` — the single method responsible for generating the cryptographic proof (ClientIVC). All other operations (witness generation, kernel circuit simulation) run locally in the PXE.

In **remote** mode, `createChonkProof`:

1. Fetches the server's attestation document from `/attestation`
2. Verifies the Nitro attestation (COSE_Sign1 signature, certificate chain, PCRs)
3. Encrypts the proving inputs with the server's attested public key (curve25519 + AES-256-GCM)
4. POSTs the encrypted data to `/prove` (with automatic retry on transient failures)
5. Deserializes and returns the proof

In **local** mode, it delegates to the parent `BBLazyPrivateKernelProver.createChonkProof` which runs Barretenberg WASM in the browser or Node.js.

## Requirements

- Aztec `5.0.0-nightly` or compatible version
- A running TEE-Rex server for remote proving
- A running Aztec node for PXE connectivity

## Contributors

Made with ♥️ by alejo · inspired by [nemi.fi](https://github.com/nemi-fi/tee-rex/)
