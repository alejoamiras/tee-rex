# TEE-Rex App

Demo frontend for TEE-Rex — compare local, UEE, and TEE proving modes for Aztec transactions.

**Live demos:** [mainnet.tee-rex.dev](https://mainnet.tee-rex.dev) | [testnet.tee-rex.dev](https://testnet.tee-rex.dev) | [nightlies.tee-rex.dev](https://nightlies.tee-rex.dev)

## Development

```sh
bun install
bun run dev                   # local Aztec node (localhost:8080)
bun run dev:testnet:prod      # testnet with hosted prover + TEE
```

The dev server runs on port 5173 and proxies `/aztec`, `/prover`, and `/tee` to the configured backends.

## What It Demonstrates

- Embedded wallet creation with `TeeRexProver` injected into the PXE
- External wallet connection via `@aztec/wallet-sdk`
- Switching between local (WASM), UEE, and TEE proving modes at runtime
- Account deployment, token deploy, mint, and private transfer flows with step-by-step timing

For production SDK integration, see the [SDK README](../sdk/README.md).
