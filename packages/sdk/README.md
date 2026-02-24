# @alejoamiras/tee-rex

Delegate [Aztec](https://aztec.network) transaction proving to a Trusted Execution Environment.

[![npm](https://img.shields.io/npm/v/@alejoamiras/tee-rex)](https://www.npmjs.com/package/@alejoamiras/tee-rex)
[![SDK](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml)

Supports **two TEE backends**: AWS Nitro Enclaves and Intel SGX (via Gramine). The SDK auto-detects the backend from the server's `/attestation` response and handles encryption, attestation verification, and proof deserialization transparently.

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
// Nitro Enclave attestation (AWS)
prover.setAttestationConfig({
  requireAttestation: true,
  expectedPCRs: { 0: "abc123..." },
  maxAgeMs: 5 * 60 * 1000,
});

// SGX attestation (Intel, via Azure MAA)
prover.setAttestationConfig({
  requireAttestation: true,
  expectedMrEnclave: "398bdbd5122052...",
  expectedMrSigner: "a1b2c3d4e5f6...",
});
```

## API

### `TeeRexProver`

Aztec private kernel prover that can generate proofs locally or on a remote
tee-rex server running inside an AWS Nitro Enclave or Intel SGX enclave.

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
- **`setAttestationConfig(config)`** — configure attestation verification (PCR/MRENCLAVE checks, freshness, require TEE)
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
  expectedPCRs?: Record<number, string>;  // Nitro: expected PCR values (hex)
  expectedMrEnclave?: string;  // SGX: expected MRENCLAVE (hex)
  expectedMrSigner?: string;   // SGX: expected MRSIGNER (hex)
  maaEndpoint?: string;  // SGX: Azure MAA endpoint (default: shared East US)
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

### `verifySgxAttestation`

Verify an SGX DCAP attestation quote via Azure MAA and extract the public key. Used internally by `TeeRexProver` but exported for advanced use cases.

```ts
function verifySgxAttestation(
  quoteBase64: string,
  publicKey: string,
  options?: SgxAttestationVerifyOptions,
): Promise<SgxAttestationResult>
```

### `AttestationError` / `SgxAttestationError`

Errors thrown when attestation verification fails. Include a machine-readable `code` for programmatic handling.

```ts
// Nitro
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

// SGX
class SgxAttestationError extends Error {
  readonly code: SgxAttestationErrorCode;
}

const SgxAttestationErrorCode = {
  INVALID_QUOTE: "INVALID_QUOTE",
  MAA_VERIFICATION_FAILED: "MAA_VERIFICATION_FAILED",
  JWT_VERIFICATION_FAILED: "JWT_VERIFICATION_FAILED",
  MRENCLAVE_MISMATCH: "MRENCLAVE_MISMATCH",
  MRSIGNER_MISMATCH: "MRSIGNER_MISMATCH",
  EXPIRED: "EXPIRED",
  REPORT_DATA_MISMATCH: "REPORT_DATA_MISMATCH",
} as const;
```

## How It Works

`TeeRexProver` extends Aztec's `BBLazyPrivateKernelProver` and overrides `createChonkProof` — the single method responsible for generating the cryptographic proof (ClientIVC). All other operations (witness generation, kernel circuit simulation) run locally in the PXE.

In **remote** mode, `createChonkProof`:

1. Fetches the server's attestation from `/attestation`
2. Auto-detects the TEE backend from the response (`mode: "nitro"` or `mode: "sgx"`)
3. Verifies attestation:
   - **Nitro**: COSE_Sign1 signature → AWS Nitro Root CA certificate chain → PCR values
   - **SGX**: DCAP quote → Azure MAA → JWT signature verification → MRENCLAVE/MRSIGNER → public key hash binding
4. Encrypts the proving inputs with the enclave's attested public key (OpenPGP):
   - **Nitro**: curve25519 + AES-256-GCM
   - **SGX**: P-256 + AES-256-GCM (Gramine's OpenSSL lacks curve25519)
5. POSTs the encrypted data to `/prove`
6. Deserializes and returns the proof

In **local** mode, it delegates to the parent `BBLazyPrivateKernelProver.createChonkProof` which runs Barretenberg WASM in the browser or Node.js.

The server never sees plaintext in either TEE mode — it forwards the encrypted blob to the enclave, which decrypts and proves.

## Requirements

- Aztec `5.0.0-nightly` or compatible version
- A running TEE-Rex server for remote proving
- A running Aztec node for PXE connectivity

## Contributors

Made with ♥️ by alejo · inspired by [nemi.fi](https://github.com/nemi-fi/tee-rex/)
