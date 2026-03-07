# Nightly-to-Devnet Backport Guide

When backporting nightly code to the devnet branch, these breaking changes from `5.0.0-nightly.20260307` must be **reverted** since devnet (`4.0.0-devnet.2-patch.4`) uses the old API.

## Breaking Changes

### 1. `simulate()` returns object instead of bare value

**Nightly** (new):
```ts
const { result: value } = await contract.methods.foo(args).simulate({ from });
const sim = await method.simulate({ includeMetadata: true });
// sim.stats, sim.estimatedGas are optional fields on the object
```

**Devnet** (old):
```ts
const value = await contract.methods.foo(args).simulate({ from });
const sim = await method.simulate({ includeMetadata: true }); // returns { stats, estimatedGas } directly
```

### 2. `send()` with `NO_WAIT` returns object instead of bare TxHash

**Nightly** (new):
```ts
const { txHash } = await method.send({ ...opts, wait: NO_WAIT });
```

**Devnet** (old):
```ts
const txHash = await method.send({ ...opts, wait: NO_WAIT });
```

### 3. `send()` without `NO_WAIT` returns object instead of bare receipt

**Nightly** (new):
```ts
const { receipt } = await method.send({ from });
// or for deploy:
const { contract: myContract } = await MyContract.deploy(wallet, ...args).send({ from });
```

**Devnet** (old):
```ts
const receipt = await method.send({ from });
const myContract = await MyContract.deploy(wallet, ...args).send({ from });
```

## Affected Files

### `packages/app/src/aztec.ts`

| Line | Code | Issue |
|------|------|-------|
| 446 | `await method.simulate(sendOpts)` | Result unused, but type changed. OK on devnet as-is. |
| 448 | `return await method.send({ ...sendOpts, wait: NO_WAIT })` | **Must return bare `TxHash` on devnet** (no destructuring) |
| 472 | `const simResult = await method.simulate({ ...sendOpts, includeMetadata: true })` | On nightly, `simResult.stats` is optional field. On devnet, returned directly. Check `extractSimDetail` still works. |
| 555 | `const simResult = await deployMethod.simulate({ ...sendOpts, includeMetadata: true })` | Same as above |
| 758-759 | `token.methods.balance_of_private(alice).simulate({ from: alice })` | **On nightly returns `{ result }`, on devnet returns bare value** |

### `packages/sdk/e2e/e2e-helpers.ts`

| Line | Code | Issue |
|------|------|-------|
| 31-35 | `const deployedContract = await deployMethod.send({...})` | **On nightly returns `{ contract, receipt }`, on devnet returns the contract directly** |

## Backport Checklist

When moving code from nightly branch to devnet branch:

- [ ] Remove `{ txHash }` destructuring from `send({ wait: NO_WAIT })` calls
- [ ] Remove `{ result }` destructuring from `simulate()` calls
- [ ] Remove `{ receipt }` / `{ contract }` destructuring from `send()` / deploy calls
- [ ] Verify `extractSimDetail` handles the old `simulate({ includeMetadata: true })` return shape
- [ ] Check `balance_of_private().simulate()` returns bare bigint (not object)
- [ ] Check `e2e-helpers.ts` `deployMethod.send()` returns contract directly
- [ ] Run `bun run test` on devnet branch after backport
