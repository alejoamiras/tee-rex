# TEE-Rex App

Demo frontend for TEE-Rex — compare local, UEE, and TEE proving modes for Aztec transactions.

**Live demos:** [nextnet.tee-rex.dev](https://nextnet.tee-rex.dev) | [devnet.tee-rex.dev](https://devnet.tee-rex.dev)

## Development

```sh
bun install
bun run dev                   # local Aztec node (localhost:8080)
bun run dev:nextnet:prod      # nextnet with hosted prover + TEE
bun run dev:devnet            # devnet with hosted prover + TEE
```

The dev server runs on port 5173 and proxies `/aztec`, `/prover`, and `/tee` to the configured backends.

## What It Demonstrates

- Embedded wallet creation with `TeeRexProver` injected into the PXE
- External wallet connection via `@aztec/wallet-sdk`
- Switching between local (WASM), UEE, and TEE proving modes at runtime
- Account deployment, token deploy, mint, and private transfer flows with step-by-step timing

For production SDK integration, see the [SDK README](../sdk/README.md).
