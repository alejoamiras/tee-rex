# @alejoamiras/tee-rex

Delegate [Aztec](https://aztec.network) transaction proving to a Trusted Execution Environment.

[![npm](https://img.shields.io/npm/v/@alejoamiras/tee-rex)](https://www.npmjs.com/package/@alejoamiras/tee-rex)
[![SDK](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml/badge.svg)](https://github.com/alejoamiras/tee-rex/actions/workflows/sdk.yml)

## Installation

```sh
npm add @alejoamiras/tee-rex
```

The SDK version tracks Aztec nightly releases. Use dist-tags to install the right version for your network:

```sh
npm add @alejoamiras/tee-rex@nightlies  # latest nightly (nextnet-compatible)
npm add @alejoamiras/tee-rex@devnet     # devnet-compatible
```

## Hosted Servers

Public TEE-Rex servers are available for both Aztec networks. No authentication or AWS account required — the SDK handles encryption automatically.

| Network | Prover URL | TEE URL |
|---------|-----------|---------|
| Nextnet | `https://nextnet.tee-rex.dev/prover` | `https://nextnet.tee-rex.dev/tee` |
| Devnet  | `https://devnet.tee-rex.dev/prover`  | `https://devnet.tee-rex.dev/tee`  |

- Rate limited to **10 proofs per hour per IP**
- Security: client encrypts proving inputs with the server's attested public key (curve25519 + AES-256-GCM) — the server never sees plaintext data outside the TEE
- You need your own Aztec node URL (e.g. `https://v4-devnet-2.aztec-labs.com` for devnet)

## Quick Start

Drop `TeeRexProver` into your PXE as a custom prover:

```ts
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createPXE } from "@aztec/pxe/client/lazy";
import { getPXEConfig } from "@aztec/pxe/config";
import { WASMSimulator } from "@aztec/simulator/client";
import { TeeRexProver } from "@alejoamiras/tee-rex";

const node = createAztecNodeClient("<your-aztec-node-url>");

const prover = new TeeRexProver("https://nextnet.tee-rex.dev/prover", new WASMSimulator());
const pxe = await createPXE(node, getPXEConfig(), {
  proverOrOptions: prover,
});

// use the PXE as usual — proving is delegated to the TEE
```

## Embedded Wallet Integration

The most common production pattern uses `TeeRexProver` with Aztec's `EmbeddedWallet`:

```ts
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createPXE, getPXEConfig } from "@aztec/pxe/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import { createStore } from "@aztec/kv-store/indexeddb";
import { EmbeddedWallet, WalletDB } from "@aztec/wallets/embedded";
import { TeeRexProver } from "@alejoamiras/tee-rex";

// 1. Create prover and connect to an Aztec node
const prover = new TeeRexProver("https://nextnet.tee-rex.dev/prover", new WASMSimulator());
const node = createAztecNodeClient("<your-aztec-node-url>");

// 2. Initialize PXE with the TEE-Rex prover
const l1Contracts = await node.getL1ContractAddresses();
const rollupAddress = l1Contracts.rollupAddress;
const pxeConfig = getPXEConfig();
pxeConfig.proverEnabled = true;
pxeConfig.l1Contracts = l1Contracts;

const pxe = await createPXE(node, pxeConfig, { proverOrOptions: prover });

// 3. Create EmbeddedWallet
const store = await createStore(`wallet-${rollupAddress}`, {
  dataDirectory: "wallet",
  dataStoreMapSizeKb: 2e10,
});
const walletDB = WalletDB.init(store);
const wallet = new EmbeddedWallet(pxe, node, walletDB);

// 4. Use the wallet — proving happens remotely in the TEE
const account = await wallet.createSchnorrAccount(secret, salt, signingKey);
```

## Mode Switching

```ts
import { ProvingMode } from "@alejoamiras/tee-rex";

// delegate proving to a remote TEE (default)
prover.setProvingMode(ProvingMode.remote);

// or prove locally in WASM (fallback)
prover.setProvingMode(ProvingMode.local);
```

## Attestation Configuration

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

## API Reference

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

- **`apiUrl`** — TEE-Rex server endpoint (e.g. `https://nextnet.tee-rex.dev/prover`)
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

## Compatibility

The SDK version scheme tracks Aztec nightly releases:

| SDK Version | Aztec Network | Install Command |
|-------------|---------------|-----------------|
| `5.x.x-nightly.*` | Nextnet | `npm add @alejoamiras/tee-rex@nightlies` |
| `5.x.x-devnet.*` | Devnet | `npm add @alejoamiras/tee-rex@devnet` |

To install a specific version:

```sh
npm add @alejoamiras/tee-rex@5.0.0-nightly.20260303
```

Requirements:
- Aztec `5.0.0-nightly` or compatible version
- A running Aztec node for PXE connectivity
- A TEE-Rex server for remote proving (or use the [hosted servers](#hosted-servers))

## Self-Hosting

To run your own TEE-Rex server (standalone or in an AWS Nitro Enclave), see the [Server README](../server/README.md).

## Contributors

Made with &#9829; by alejo · inspired by [nemi.fi](https://github.com/nemi-fi/tee-rex/)
