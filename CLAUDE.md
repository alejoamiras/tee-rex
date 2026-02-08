# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **Repo**: `alejoamiras/tee-rex` (GitHub)
- **SDK** (`/packages/sdk`): TypeScript package `@alejoamiras/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **Demo** (`/packages/demo`): Vite + vanilla TS frontend — local/remote/TEE mode toggle, timing, token flow
- **Build system**: Bun workspaces (`packages/sdk`, `packages/server`, `packages/demo`)
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits)
- **CI**: GitHub Actions (per-package, path-filtered workflows: `ci-sdk.yml`, `ci-demo.yml`, `ci-server.yml`)
- **Testing**: Each package owns its own unit tests (`src/`) and e2e tests (`e2e/`). E2e tests fail (not skip) when services unavailable.
- **Test structure convention**: Group tests under the subject being tested, nest by variant — don't create separate files per variant when they share setup. Example: `describe("TeeRexProver")` > `describe("Remote")` / `describe("Local")` / `describe.skipIf(...)("TEE")`. Extract shared logic (e.g., `deploySchnorrAccount()`) into helpers within the file.
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

# Run e2e tests (requires Aztec local network + tee-rex server)
bun run test:e2e

# Run all tests (lint + typecheck + unit + e2e)
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
- Integration tests for connectivity, remote proving, local proving, and mode switching
- Full proving flow tests (TeeRexProver → TestWallet → Account deployment)
- Proper timeouts for long-running proving operations

**Note:** Originally a separate `packages/integration` workspace. Later restructured into `packages/sdk/e2e/` (see Phase 7).

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
- **D** ✅ — Full token flow demo: deploy token + mint to private + private transfer + check balances in one click

**Status**: A, B, C & D complete

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

## Phase 7: Demo Frontend Testing ✅ Complete

**Goal**: Proper test coverage for the demo app + restructure all test infrastructure.

**Completed:**
- **Unit tests**: 6 tests for demo utility functions (`ui.ts`, `aztec.ts` state management)
- **Mocked E2E**: 8 Playwright tests (mode switching, TEE config panel, service dots, log panel) — no services needed
- **Fullstack E2E**: 12 Playwright tests (deploy, token flow, all 6 mode-switch combinations across remote/local/TEE) — requires Aztec + tee-rex
- **Test restructuring**: Eliminated `packages/integration/` — SDK owns its e2e in `packages/sdk/e2e/`, demo owns its e2e in `packages/demo/e2e/`
- **Playwright projects**: Single `playwright.config.ts` with `mocked` and `fullstack` projects (different timeouts, test patterns)
- **Assert-or-throw**: E2e tests fail (not skip) when services unavailable. TEE tests skip only when `TEE_URL` env var is not set.
- **Per-package CI**: `ci-sdk.yml`, `ci-demo.yml`, `ci-server.yml` — no monolithic test workflow

---

## Phase 8: Repo Rename & Reference Update ✅ Complete

**Goal**: Update all references from `nemi-fi` to `alejoamiras` throughout the codebase.

**Completed:** Updated 15+ files — package names, imports, npm badges, CI workflows, docs. Biome auto-fixed import ordering (`@alejoamiras` sorts before `@aztec`).

---

## Phase 9: CI Granular Jobs ✅ Complete

**Goal**: Split each CI workflow into granular, parallel checks.

**Completed:** Each workflow now has separate jobs (Lint, Typecheck, Unit Tests, E2E) that run in parallel. Failures are immediately visible (e.g., "SDK/Typecheck failed").

---

## Phase 10: E2E CI with Aztec Local Network ✅ Complete

**Goal**: Run SDK and Demo e2e tests in CI against a real Aztec local network.

**Completed:**
- SDK E2E job in `sdk.yml` — installs Foundry + Aztec CLI, starts local network + tee-rex, runs `bun test e2e/`
- Demo Fullstack E2E job in `demo.yml` — same infra + Playwright with chromium, runs `test:e2e:fullstack`
- Aztec CLI cached by version (`~/.aztec/versions/<VERSION>/`) — install step skipped on cache hit
- `AZTEC_VERSION` env var as single source of truth per workflow
- Both triggered on PRs and pushes to main (path-filtered)
- Separate health-check steps for Aztec node and tee-rex server

---

## Phase 11: AWS TEE Infrastructure Research & Scaling (Research ✅, Benchmarking Pending)

**Goal**: Research and deploy tee-rex on a beefier AWS instance for faster proving, with a clear understanding of costs.

**Research completed:**
- Compute-optimized c-family is best for Barretenberg (CPU-bound)
- Top 3 candidates to benchmark:
  - **c6a.2xlarge** ($0.306/hr) — 6 enclave vCPUs, AMD EPYC Milan, cheapest 3x upgrade
  - **c6i.2xlarge** ($0.340/hr) — 6 enclave vCPUs, Intel Ice Lake, test AVX-512 optimizations
  - **c6a.4xlarge** ($0.612/hr) — 14 enclave vCPUs, test scaling ceiling
- Current m5.xlarge gives only 2 enclave vCPUs; any `.2xlarge` gives 6 (3x)

**Remaining (tackle last):**
1. Benchmark current proving times on m5.xlarge (baseline)
2. Deploy on 2-3 candidate instance types, measure proving times
3. Pick the best price/performance option
4. Update deployment docs and allocator config

---

## Phase 12: Aztec Nightly Auto-Update CI (Golden Bow) ✅ Complete

**Goal**: CI pipeline that detects new Aztec nightly versions, updates deps, runs full test suite (including TEE), and opens a PR.

**Completed:**
- `scripts/check-aztec-nightly.ts` — checks npm `nightly` dist-tag, verifies all 11 `@aztec/*` packages exist at new version
- `scripts/update-aztec-version.ts` — updates 3 package.json + 2 workflow files + runs `bun install`
- `scripts/update-aztec-version.test.ts` — 12 unit tests for version validation, JSON/YAML update logic
- `.github/workflows/aztec-nightly.yml` — 6-job pipeline: check → update + unit test → SDK e2e / demo e2e / TEE e2e → create PR
- Reusable workflows (`_e2e-sdk.yml`, `_e2e-demo.yml`, `_e2e-tee.yml`) + composite actions (`setup-aztec`, `start-services`)
- Runs daily at 08:00 UTC (weekdays), plus manual dispatch with version override
- PRs labeled `nightly-failing` when tests fail
- `bun run aztec:check` and `bun run aztec:update <version>` for local use

**TEE E2E pipeline (`_e2e-tee.yml`):**
- AWS OIDC authentication (no stored secrets) via `aws-actions/configure-aws-credentials`
- Builds `Dockerfile.nitro` → pushes to ECR → starts pre-configured EC2 instance
- Deploys enclave via SSM using `infra/ci-deploy.sh` (base64 upload to avoid escaping)
- Runs SDK + demo e2e with `TEE_URL` pointing to EC2 public IP
- Always stops EC2 instance on teardown (`if: always()`)
- IAM policy: minimal permissions scoped by ECR repo ARN + EC2 `Environment: ci` tag
- Cost: ~$5/month (compute + EBS + ECR storage)

**AWS setup documentation:** `infra/iam/README.md` (OIDC provider, IAM role + policy, EC2 instance, GitHub variables)

**Future additions:**
- npm publish — trigger after green tests
- Auto-merge — merge PR automatically when all tests pass
- SSM port forwarding — eliminate public port 4000 exposure

---

## Phase 13: Evaluate OpenPGP Encryption Necessity ✅ Complete

**Goal**: Investigate whether OpenPGP encryption of proving inputs is justified and harden the crypto parameters.

**Findings:**
- **TEE mode**: Encryption is essential — vsock traffic between EC2 host and enclave is NOT encrypted. A compromised host kernel can read it. This matches industry practice (Evervault, Marlin, Secret Network, Phala all use app-level encryption).
- **Non-TEE mode**: Encryption provides defense-in-depth (protects against logging middleware, network intermediaries) but doesn't protect against a malicious server operator who has memory access.
- **Proving inputs**: Public function witnesses aren't deeply secret but pre-publication exposure enables front-running. Encryption overhead is negligible vs proving time.
- **Decision**: Keep encryption everywhere. No code changes to the encryption flow.

**Security review of OpenPGP parameters (`TODO(security)` resolved):**
- Curve: `nistP256` → `curve25519` (better side-channel resistance, auditable constants, OpenPGP.js recommended)
- Key type: `type: "ecc"` → `type: "curve25519"` (v6 native Curve25519 support)
- Integrity: SEIPD + MDC (SHA-1) → SEIPDv2 with AES-256-GCM (`aeadProtect: true`)
- Session cipher: AES-256 (unchanged, strong default)
- No passphrase: correct for in-memory TEE keys
- Redeployed Nitro enclave with updated image, verified attestation + E2E tests pass

---

## Phase 14: SDK E2E Test Improvements — TEE + Mode Switching ✅ Complete

**Goal**: Restructure SDK e2e tests to match the demo's elegant pattern — test TEE mode and mode switching, with TEE tests skipping gracefully when `TEE_URL` isn't set.

**Completed:**
- Consolidated `remote-proving.test.ts`, `local-proving.test.ts`, `tee-proving.test.ts` into a single `proving.test.ts` with nested describes: `TeeRexProver` > `Remote` / `Local` / `TEE`
- Shared setup (prover + wallet created once), `deploySchnorrAccount()` helper eliminates boilerplate
- TEE describe blocks use `describe.skipIf(!config.teeUrl)` — skip when `TEE_URL` not set
- `mode-switching.test.ts` extended with TEE transitions: local→TEE, TEE→local, TEE→standard remote
- `e2e-setup.ts` exports `teeUrl` from `TEE_URL` env var

**SDK e2e test structure:**
| File | Purpose |
|---|---|
| `e2e-setup.ts` | Preload — asserts services, exports config |
| `connectivity.test.ts` | Service health checks |
| `proving.test.ts` | One deploy per mode (Remote / Local / TEE) |
| `mode-switching.test.ts` | Remote→Local + TEE transitions |

---

## Phase 15: TEE Generalization Research

**Goal**: Research whether the tee-rex implementation can be generalized to support other TEE types beyond AWS Nitro Enclaves (e.g., Intel SGX/TDX, AMD SEV, ARM CCA).

**This is research only — no code changes unless the abstraction is clean.**

**Questions to answer:**
1. What's the common abstraction across TEE types? (attestation format, key provisioning, isolation model)
2. Where does tee-rex currently hard-code Nitro-specific logic? (NSM device, COSE_Sign1 attestation format, Nitro root CA)
3. Could we define a `TeeProvider` interface that abstracts: `generateAttestation(publicKey)` + `verifyAttestation(doc)`?
4. What would SGX/TDX support look like? (DCAP attestation, different certificate chain)
5. Is the complexity worth it, or is Nitro-only the right scope for this project?

**Possible outcomes:**
- Define the interface but only implement Nitro (clean extensibility without over-engineering)
- Keep Nitro-only if the abstraction is too leaky
- Identify a few quick wins (e.g., make attestation verification pluggable)

---

## Backlog

- Phase 6 (next-net testing) is now part of Phase 12 (Golden Bow)

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
