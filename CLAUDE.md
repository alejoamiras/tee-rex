# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **SDK** (`/packages/sdk`): TypeScript package `@nemi-fi/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **Integration** (`/packages/integration`): Integration tests for the full proving flow
- **Build system**: Bun workspaces (`packages/*`)
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits)
- **CI**: GitHub Actions (per-package, path-filtered workflows)
- **Aztec version**: 4.0.0-nightly.20260204

---

## Workflow: How to Execute Any Task

**Before writing any code**, always follow this workflow:

### 1. Research

- Read the relevant source files and existing tests
- Search the codebase for patterns, imports, and conventions already in use
- If the task involves unfamiliar libraries or APIs, search the web for docs/examples
- Understand what exists before changing anything

### 2. To-do list

- Create a to-do list (using the task tracking tools) breaking the work into small, incremental steps
- Each step should be independently verifiable — if something breaks, you know exactly which step caused it
- Order steps so that earlier steps don't depend on later ones
- Prefer adding one test at a time, one function at a time, one file at a time

### 3. Iterative execution

- Work through the to-do list one step at a time
- After each step, validate before moving on (see below)
- If a step breaks something, fix it before continuing — don't accumulate broken state
- Never make large, multi-file changes in a single step when smaller steps are possible

### 3b. Lesson tracking (CRITICAL — prevents loops)

When working on infrastructure, deployment, or debugging tasks:

- **Before trying a new approach**: Check `lessons/` for files related to the current phase. Read them to avoid repeating past mistakes.
- **After each attempt**: Record the approach and outcome in the relevant lessons file under `lessons/phase-<N>-<feature>.md`.
- **Format**: Use a table or numbered list with columns: Attempt | Approach | Result (worked/failed/partial + details).
- **When stuck after 3+ failed attempts**: STOP. Write down all attempts so far, save them, and either research the problem more deeply or ask the user for guidance. Do NOT keep looping with slight variations of the same broken approach.

### 4. Validation

Every step must include a validation strategy. Think about how to verify the step worked:

- **Code changes**: run `bun run lint` and `bun run test`
- **New tests**: run the specific test file (`bun test path/to/file.test.ts`) and verify it passes
- **Refactors**: run the full test suite to catch regressions
- **Config changes**: run the relevant command (e.g., `bun install`, `bun run build`)
- **New features**: write a test or run a manual verification script

If you're unsure how to validate a step, that's a sign the step might be too big — break it down further.

---

## Quick Start

```bash
# Install dependencies
bun install

# Run full checks (lint + typecheck + unit tests)
bun run test

# Run only linting
bun run lint

# Auto-fix lint/format issues
bun run lint:fix

# Run integration tests (auto-starts Aztec sandbox + tee-rex server)
bun run test:integration

# Run all tests
bun run test:all

# Start server
bun run start

# Build SDK
bun run sdk:build

# Build Docker image
bun run build
```

---

## Phase 1: Monorepo Migration to Bun ✅ Complete

**Goal**: Migrate from pnpm/turbo to Bun workspaces for faster builds and simpler tooling.

**Completed:**
- Replaced pnpm with Bun as package manager
- Removed Turbo, using Bun workspace commands instead
- Migrated SDK tests from vitest to bun:test
- Updated Dockerfile to use oven/bun:1.3-debian base image
- All commands now use `bun run`
- Restructured into `packages/` layout (sdk, server, integration)

---

## Phase 2: Integration Testing with Bun ✅ Complete

**Goal**: Create a proper integration test suite that runs with `bun test`.

**Completed:**
- Created `/packages/integration` workspace with test infrastructure
- **Automatic service management** - starts Aztec sandbox and tee-rex server if not running
- Connectivity tests for Aztec node and tee-rex server
- Full proving flow tests (TeeRexProver → TestWallet → Account deployment)
- Automatic cleanup of started services after tests
- Proper timeouts for long-running proving operations

**Environment variables:**
- `INTEGRATION_AUTO_START=false` - Disable automatic service startup
- `AZTEC_NODE_URL` - Custom Aztec node URL (default: http://localhost:8080)
- `TEEREX_URL` - Custom tee-rex server URL (default: http://localhost:4000)

**Note:** Requires `aztec` CLI to be installed for auto-start:
```bash
curl -fsSL https://install.aztec.network | bash
```

---

## Phase 3: Structured Logging ✅ Complete

**Goal**: Replace all `console.log` with structured logging using LogTape.

**Completed:**
- Added LogTape (`@logtape/logtape`) across SDK, server, and integration packages
- SDK uses library-first pattern (silent by default, consumers configure)
- Server uses `@logtape/express` for request logging, `@logtape/pretty` for dev, JSON Lines for production
- Error handling middleware on all Express routes
- Integration tests quiet by default (`LOG_LEVEL=warning`), verbose with `LOG_LEVEL=debug`
- Zero `console.log` calls remaining in codebase

---

## Phase 4: Testing & Demo Frontend

**Goal**: Proper unit/E2E test coverage + a demo frontend to showcase local vs remote proving speed.

**Parts:**
- **A** ✅ — Unit tests for server (`lazyValue`, `EncryptionService`, endpoints) and SDK (`encrypt`, expanded `TeeRexProver`) — 20 tests
- **B** ✅ — E2E tests for local proving, remote proving, and mode switching — 21 tests
- **C** ✅ — Demo page with three proving modes (Local/Remote/TEE) and attestation indicator
- **D** — Full token flow demo: deploy token + mint + shield + private transfer in one click

**Status**: A, B & C complete, D not started

**Phase 4C Details**:

The demo (`packages/demo`) already has a working Vite + Tailwind frontend with local/remote mode toggle, timing display, and log output. It needs to be extended with a **third mode button** and TEE awareness:

1. **Three buttons**: Local | Remote | Remote + TEE
   - **Local**: Proves using in-browser WASM Barretenberg (current `local` mode)
   - **Remote**: Proves via local tee-rex server at `localhost:4000` (current `remote` mode, standard attestation)
   - **Remote + TEE**: Proves via the Nitro Enclave server (configurable URL, requires Nitro attestation)
2. **TEE indicator**: When using Remote + TEE, show attestation status — verified/unverified, mode (nitro/standard), PCR0 snippet
3. **Server URL config**: Input field or env var for the TEE server URL (since it's on EC2, not localhost)
4. **Attestation badge**: Fetch `/attestation` and display `mode: "nitro"` vs `mode: "standard"` with a visual indicator

**Implementation notes**:
- `aztec.ts` currently hardcodes `TEEREX_URL = "http://localhost:4000"` — needs to become configurable per mode
- The SDK's `setAttestationConfig()` should be called when switching to TEE mode
- Results panel already has local/remote cards — add a third "tee" card for side-by-side timing comparison

**Planning document**: See `/plans/phase-4-testing-and-demo.md`

**Phase 4D Details — Full Token Flow Demo**:

Currently the demo only deploys a Schnorr account (one proving step). A more compelling demo would execute a full token lifecycle in one click, logging each step with timing:

1. **Deploy TokenContract** — `TokenContract.deploy(wallet, admin, 'TeeRexToken', 'TREX', 18)`
2. **Mint to private** — `token.methods.mint_to_private(alice, 1000n)` (mints directly into private balance, avoids shield/redeem complexity)
3. **Private transfer** — `token.methods.transfer(bob, 500n)` (fully private token send)
4. **Check balances** — `balance_of_private(alice)` + `balance_of_private(bob)` (simulate calls, proves state is correct)

Each step generates ZK proofs, so the demo shows multiple proving rounds per mode. This is more representative of real usage and more impressive for the show-and-tell.

**Key imports:**
```typescript
import { TokenContract } from '@aztec/noir-contracts.js/Token';
```

**Implementation notes:**
- Add a second action button ("Run Token Flow") alongside the existing "Deploy Test Account"
- Each step logs to the log panel with its own timing
- Total time shown in the result card
- The existing account deploy is still useful as a quick sanity check; the token flow is the "full demo"
- Reference: `aztec-packages/docs/examples/ts/aztecjs_advanced/index.ts` and `aztec-packages/yarn-project/end-to-end/src/fixtures/token_utils.ts`
- Uses `mint_to_private` (simpler than `mint_to_public` → `shield` → `redeem_shield`)

---

## Phase 5: TEE Attestation & Nitro Enclave Deployment (In Progress)

**Goal**: Real TEE attestation via AWS Nitro Enclaves — SDK verifies COSE_Sign1 attestation documents, server generates them via libnsm.so FFI.

**Parts:**
- **A** ✅ — Attestation verification in SDK (`verifyNitroAttestation`, COSE_Sign1/CBOR parsing, cert chain validation)
- **B** ✅ — Server `NitroAttestationService` with Bun FFI calls to libnsm.so
- **C** ✅ — `Dockerfile.nitro` multi-stage build (Rust → libnsm.so, Bun builder, runtime with socat/vsock bridge)
- **D** ✅ — AWS Nitro Enclave deployment on EC2 — working! Real attestation documents returned.

**Lessons learned**: See `lessons/phase-5d-nitro-enclave-deployment.md`

**Key fix**: `ifconfig lo 127.0.0.1` (not just `ip link set lo up`) — must assign the IP address, not just bring the link up.

- **E** — Deployment runbook & debugging guide (`docs/nitro-deployment.md`)

**Phase 5E Details**:

Write a complete step-by-step runbook so any team member can deploy, debug, and tear down the Nitro Enclave from scratch. Should cover:

1. **Prerequisites**: AWS CLI configured, Docker with buildx, region/account info
2. **Infrastructure setup**: Create ECR repo, security group, IAM role + instance profile, key pair (or reuse existing)
3. **Build & push**: `docker buildx build` for linux/amd64, ECR login, push
4. **Launch EC2**: Instance type, AMI, user-data script, enclave options, wait for bootstrap
5. **Build & run enclave**: `nitro-cli build-enclave`, `nitro-cli run-enclave` with correct memory/CPU, socat proxy setup
6. **Test**: curl the attestation endpoint, verify `mode: "nitro"`
7. **Debugging**: SSH into host, `nitro-cli console`, `nitro-cli describe-enclaves`, reading `/var/log/nitro_enclaves/`, common errors (E11, E26, E45, E51)
8. **Iterating**: How to rebuild after code changes (push new image, terminate old enclave, rebuild EIF, relaunch)
9. **Teardown**: Terminate instance, optionally delete infra
10. **Cost awareness**: Instance pricing, spot instance option, don't leave running overnight

Source material: `lessons/phase-5d-nitro-enclave-deployment.md` + the scratchpad `user-data.sh` + this session's commands

---

## Phase 6: End-to-End Testing on Next-Net

**Goal**: Validate the full proving flow against Aztec's next-net (nightly network) — both locally and from inside the Nitro Enclave.

**Context**: So far, all testing uses `--local-network` (sandbox). We haven't tested with a real proving payload against a real network. Next-net runs the same nightly version we depend on (`4.0.0-nightly.20260204`), so it's the right target.

**Parts:**
- **A** — Local client → next-net proving (verify the SDK + local prover works against next-net)
- **B** — Local client → TEE server (EC2 enclave) → next-net proving (full remote flow)
- **C** — Demo frontend pointing at next-net + TEE server (visual end-to-end)

**What needs to happen:**
1. Configure `AZTEC_NODE_URL` to point at next-net (URL TBD — check with Aztec team)
2. Test account deployment + transaction proving against next-net from local machine
3. Test same flow but with `provingMode: "remote"` pointing at the EC2 enclave
4. Verify attestation documents are checked in the remote flow
5. Measure proving times: local WASM vs remote native (enclave) — this is the key metric for the show-and-tell

**Risks:**
- Next-net may have different contract class requirements or gas settings
- Network latency (client → EC2 → next-net) could affect timeouts
- Proving payload size over the wire (encrypted witness data) — may need to tune body size limits

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
