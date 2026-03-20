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
npm add @alejoamiras/tee-rex@nightlies  # latest nightly (v4)
npm add @alejoamiras/tee-rex@rc         # latest release candidate
```

## Hosted Servers

Public TEE-Rex servers are available for both Aztec networks. No authentication or AWS account required — the SDK handles encryption automatically.

| Network | Prover URL | TEE URL |
|---------|-----------|---------|
| Mainnet | `https://mainnet.tee-rex.dev/prover` | `https://mainnet.tee-rex.dev/tee` |
| Testnet | `https://testnet.tee-rex.dev/prover` | `https://testnet.tee-rex.dev/tee` |
| Nightlies | `https://nightlies.tee-rex.dev/prover` | `https://nightlies.tee-rex.dev/tee` |

- Rate limited to **10 proofs per hour per IP**
- Security: client encrypts proving inputs with the server's attested public key (curve25519 + AES-256-GCM) — the server never sees plaintext data outside the TEE
- You need your own Aztec node URL (e.g. `https://rpc.testnet.aztec-labs.com` for testnet)

## Quick Start

Drop `TeeRexProver` into your PXE as a custom prover:

```ts
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createPXE } from "@aztec/pxe/client/lazy";
import { getPXEConfig } from "@aztec/pxe/config";
import { TeeRexProver } from "@alejoamiras/tee-rex";

const node = createAztecNodeClient("<your-aztec-node-url>");

const prover = new TeeRexProver({ apiUrl: "https://testnet.tee-rex.dev/prover" });
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
import { createStore } from "@aztec/kv-store/indexeddb";
import { EmbeddedWallet, WalletDB } from "@aztec/wallets/embedded";
import { TeeRexProver } from "@alejoamiras/tee-rex";

// 1. Create prover and connect to an Aztec node
const prover = new TeeRexProver({ apiUrl: "https://testnet.tee-rex.dev/prover" });
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

// 4. Use the wallet — proving happens in the TEE
const account = await wallet.createSchnorrAccount(secret, salt, signingKey);
```

## Mode Switching

The proving mode can be set via the constructor or at runtime:

```ts
import { TeeRexProver } from "@alejoamiras/tee-rex";

// UEE mode (default when apiUrl is provided)
const prover = new TeeRexProver({ apiUrl: "https://testnet.tee-rex.dev/prover" });

// Local mode (WASM proving, always works)
const prover = new TeeRexProver();

// TEE mode (apiUrl + attestation required by TypeScript)
const prover = new TeeRexProver({
  provingMode: "tee",
  apiUrl: "https://testnet.tee-rex.dev/tee",
  attestation: { requireAttestation: true },
});

// Switch modes at runtime
prover.setProvingMode("uee", { apiUrl: "https://testnet.tee-rex.dev/prover" });
prover.setProvingMode("tee", {
  apiUrl: "https://testnet.tee-rex.dev/tee",
  attestation: { requireAttestation: true },
});
prover.setProvingMode("local");
```

## Attestation Configuration

```ts
// Via constructor
const prover = new TeeRexProver({
  provingMode: "tee",
  apiUrl: "https://testnet.tee-rex.dev/tee",
  attestation: {
    requireAttestation: true,
    expectedPCRs: { 0: "abc123..." },
    maxAgeMs: 5 * 60 * 1000,
  },
});

// Or at runtime
prover.setAttestationConfig({
  requireAttestation: true,
  expectedPCRs: { 0: "abc123..." },
  maxAgeMs: 5 * 60 * 1000,
});
```

## API Reference

### `TeeRexProver`

Aztec private kernel prover that can generate proofs locally (WASM) or on a UEE/TEE
tee-rex server (Nitro Enclave).

```ts
class TeeRexProver extends BBLazyPrivateKernelProver {
  constructor(options?: TeeRexProverOptions)
  constructor(apiUrl: string, ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>)  // deprecated
  setProvingMode(mode: "local"): void
  setProvingMode(mode: "uee", opts: { apiUrl: string; attestation?: TeeRexAttestationConfig }): void
  setProvingMode(mode: "tee", opts: { apiUrl: string; attestation: TeeRexAttestationConfig }): void
  setApiUrl(url: string): void
  setAttestationConfig(config: TeeRexAttestationConfig): void
  createChonkProof(executionSteps: PrivateExecutionStep[]): Promise<ChonkProofWithPublicInputs>
}
```

- **`options.apiUrl`** — TEE-Rex server endpoint (e.g. `https://testnet.tee-rex.dev/prover`)
- **`options.provingMode`** — `"local"`, `"uee"`, or `"tee"`. Defaults to `"uee"` when `apiUrl` is set, `"local"` otherwise
- **`options.simulator`** — circuit simulator instance. Defaults to a lazy-loaded `WASMSimulator` (auto-imports `@aztec/simulator/client` on first use)
- **`options.attestation`** — attestation config (required for `"tee"` mode, optional for `"uee"`, forbidden for `"local"`)
- **`options.onPhase`** — phase transition callback for UI animation
- **`setProvingMode(mode, opts?)`** — switch proving mode at runtime with mode-specific options
- **`setApiUrl(url)`** — update the tee-rex server URL at runtime
- **`setAttestationConfig(config)`** — configure attestation verification (PCR checks, freshness, require TEE)
- **`createChonkProof(steps)`** — overrides the parent to route proofs based on the current proving mode

### `TeeRexProverOptions`

Discriminated union on `provingMode`:

| Mode | `apiUrl` | `attestation` |
|------|----------|---------------|
| `"local"` (default without apiUrl) | optional | forbidden |
| `"uee"` (default with apiUrl) | **required** | optional |
| `"tee"` | **required** | **required** |

### `ProvingMode`

```ts
const ProvingMode = { local: "local", uee: "uee", tee: "tee" } as const;
type ProvingMode = "local" | "uee" | "tee";
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

In **UEE** mode, `createChonkProof`:

1. Fetches the server's attestation document from `/attestation`
2. Verifies the Nitro attestation (COSE_Sign1 signature, certificate chain, PCRs)
3. Encrypts the proving inputs with the server's attested public key (curve25519 + AES-256-GCM)
4. POSTs the encrypted data to `/prove` (with automatic retry on transient failures)
5. Deserializes and returns the proof

In **local** mode, it delegates to the parent `BBLazyPrivateKernelProver.createChonkProof` which runs Barretenberg WASM in the browser or Node.js.

## Compatibility

The SDK version scheme tracks Aztec releases:

| SDK Version | Aztec Network | Install Command |
|-------------|---------------|-----------------|
| `4.x.x` (latest) | Mainnet | `npm add @alejoamiras/tee-rex` |
| `4.x.x-rc.*` | Testnet | `npm add @alejoamiras/tee-rex@rc` |
| `4.x.x-nightly.*` | Nightlies | `npm add @alejoamiras/tee-rex@nightlies` |

To install a specific version:

```sh
npm add @alejoamiras/tee-rex@4.1.0
```

Requirements:
- Aztec Edition 4 (v4.x) or compatible version
- A running Aztec node for PXE connectivity
- A TEE-Rex server for UEE proving (or use the [hosted servers](#hosted-servers))

## Self-Hosting

To run your own TEE-Rex server (standalone or in an AWS Nitro Enclave), see the [Server README](../server/README.md).

## Contributors

Made with &#9829; by alejo · inspired by [nemi.fi](https://github.com/nemi-fi/tee-rex/)
