# Phase 12C: Nextnet Investigation

## Problem

Deploying accounts via the demo against `https://nextnet.aztec-labs.com` fails with:
```
Assertion failed: Failed to get a note 'self.is_some()'
```
at `schnorr_account_contract/src/main.nr:96` — the `entrypoint` tries to read the signing key note, which doesn't exist yet.

## Root Causes

### 1. No pre-funded test accounts on nextnet

Local sandbox pre-deploys 3 test accounts with fee juice. Nextnet has none. The demo's `initializeWallet()` registers sandbox test accounts (from `@aztec/accounts/testing/lazy`), but these are only **registered locally in the PXE** — they don't exist on-chain on nextnet.

When deploying with `from: sandboxAccount[0]`, the account's entrypoint is called to authorize the tx, but the signing key note doesn't exist → assertion failure.

### 2. `proverEnabled: false` (default)

The PXE is created with `proverEnabled: false` by default. On nextnet, real proofs are required. Without `proverEnabled: true`, the PXE doesn't generate kernel proofs, and the tx would be rejected by the network even if simulation passes.

### 3. Fee payment required

Nextnet enforces fees. Every transaction needs a fee payment method. The **Sponsored FPC** (Fee Paying Contract) is a pre-deployed contract on nextnet that pays fees unconditionally — like a faucet.

## Solution (validated with investigation script)

Three changes needed for nextnet compatibility:

1. **`proverEnabled: true`** in PXE config
2. **`from: AztecAddress.ZERO`** for deploys — triggers the self-deploy path in `DeployAccountMethod`, where the account pays its own fee via the FPC
3. **`fee: { paymentMethod: new SponsoredFeePaymentMethod(fpcAddress) }`** on all `.send()` calls

### Sponsored FPC setup

```typescript
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";

// Derive the canonical FPC address (deterministic from artifact + salt=0)
const fpcInstance = await getContractInstanceFromInstantiationParams(
  SponsoredFPCContract.artifact,
  { salt: new Fr(0) },
);

// Register in local PXE so it can simulate calls to it
await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);

// Use as payment method
const paymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);

// Deploy account (self-deploy path)
await deployMethod.send({
  from: AztecAddress.ZERO,
  fee: { paymentMethod },
  skipClassPublication: true,
});
```

### Key details

- **FPC salt**: `0` (from `@aztec/constants` → `SPONSORED_FPC_SALT = 0n`)
- **FPC address**: Deterministic from artifact — changes between Aztec versions. Our `spartan.20260210` derives `0x0cc8969aefc807d1145702ef5cf7ea57801ab633fa0b5cf1527203b667812be9`
- **Gregoswap's pattern**: identical — `from: AztecAddress.ZERO`, `SponsoredFeePaymentMethod`, `proverEnabled: true`
- **Proving time on nextnet**: ~70s for account deploy (WASM prover, includes kernel proof + on-chain confirmation)

## Attempt Log

| # | Approach | Result |
|---|----------|--------|
| 1 | Deploy with `from: sandboxAccount[0]`, no fee | FAIL — signing key note not found (sandbox accounts don't exist on nextnet) |
| 2 | Deploy with no `from` | FAIL — `address.equals` is undefined (wallet can't find a sender) |
| 3 | Deploy with `from: self`, `fee: SponsoredFPC` | FAIL — same signing key error (account's entrypoint called before constructor) |
| 4 | Deploy with `from: ZERO`, `fee: SponsoredFPC`, `proverEnabled: false` | FAIL — same signing key error |
| 5 | Deploy with `from: ZERO`, `fee: SponsoredFPC`, `proverEnabled: true` | SUCCESS — 70.2s |

## Reference

- Gregoswap implementation: `~/Projects/gregoswap/scripts/deploy.ts` + `src/embedded_wallet.ts`
- Aztec docs: [Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees), [Setting up for Testnet](https://docs.aztec.network/developers/getting_started_on_testnet)
