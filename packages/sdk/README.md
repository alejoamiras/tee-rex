# @alejoamiras/tee-rex

Delegate [Aztec](https://aztec.network) transaction proving to a Trusted Execution Environment.

[![npm](https://img.shields.io/npm/v/@alejoamiras/tee-rex)](https://www.npmjs.com/package/@alejoamiras/tee-rex)

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

## API

### `TeeRexProver`

```ts
class TeeRexProver extends BBLazyPrivateKernelProver {
  constructor(apiUrl: string, ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>)
  setProvingMode(mode: ProvingMode): void
  createChonkProof(executionSteps: PrivateExecutionStep[]): Promise<ChonkProofWithPublicInputs>
}
```

- **`apiUrl`** — TEE-Rex server endpoint (e.g. `http://localhost:4000`)
- **`...args`** — forwarded to `BBLazyPrivateKernelProver` (typically a `CircuitSimulator` instance)
- **`setProvingMode(mode)`** — switch between `"remote"` (TEE) and `"local"` (WASM) proving
- **`createChonkProof(steps)`** — overrides the parent to route proofs through the TEE server in remote mode

### `ProvingMode`

```ts
const ProvingMode = { local: "local", remote: "remote" } as const;
type ProvingMode = "local" | "remote";
```

## How It Works

`TeeRexProver` extends Aztec's `BBLazyPrivateKernelProver` and overrides `createChonkProof` — the single method responsible for generating the cryptographic proof (ClientIVC). All other operations (witness generation, kernel circuit simulation) run locally in the PXE.

In **remote** mode, `createChonkProof`:

1. Serializes execution steps (bytecodes, witnesses, VKs) to JSON
2. Encrypts the payload with the TEE server's OpenPGP public key (fetched from `/encryption-public-key`)
3. POSTs the encrypted data to `/prove`
4. Deserializes and returns the proof

In **local** mode, it delegates to the parent `BBLazyPrivateKernelProver.createChonkProof` which runs Barretenberg WASM in the browser or Node.js.

## Requirements

- Aztec `4.0.0-nightly.20260204` or compatible nightly
- A running TEE-Rex server for remote proving
- A running Aztec node for PXE connectivity

## Contributors

Made with ❤️ by [Alejo Amiras](https://github.com/alejoamiras)
