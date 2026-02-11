# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **Repo**: `alejoamiras/tee-rex` (GitHub)
- **SDK** (`/packages/sdk`): TypeScript package `@alejoamiras/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **App** (`/packages/app`): Vite + vanilla TS frontend — local/remote/TEE mode toggle, timing, token flow
- **Build system**: Bun workspaces (`packages/sdk`, `packages/server`, `packages/app`)
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits)
- **CI**: GitHub Actions (per-package workflows with gate jobs: `sdk.yml`, `app.yml`, `server.yml`; spartan: `aztec-spartan.yml`; TEE: `tee.yml`)
- **Testing**: Each package owns its own unit tests (`src/`) and e2e tests (`e2e/`). E2e tests fail (not skip) when services unavailable.
- **Test structure convention**: Group tests under the subject being tested, nest by variant — don't create separate files per variant when they share setup. Example: `describe("TeeRexProver")` > `describe("Remote")` / `describe("Local")` / `describe.skipIf(...)("TEE")`. Extract shared logic (e.g., `deploySchnorrAccount()`) into helpers within the file.
- **Aztec version**: 4.0.0-nightly.20260210 (migrating to `spartan` dist-tag)

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

The app (`packages/app`) already has a working Vite + Tailwind frontend with local/remote mode toggle, timing display, and log output. It needs to be extended with a **third mode button** and TEE awareness:

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

## Phase 5: TEE Attestation & Nitro Enclave Deployment ✅ Complete

**Goal**: Real TEE attestation via AWS Nitro Enclaves — SDK verifies COSE_Sign1 attestation documents, server generates them via libnsm.so FFI.

**Completed:**
- **A** ✅ — Attestation verification in SDK (`verifyNitroAttestation`, COSE_Sign1/CBOR parsing, cert chain validation)
- **B** ✅ — Server `NitroAttestationService` with Bun FFI calls to libnsm.so
- **C** ✅ — `Dockerfile.nitro` multi-stage build (Rust → libnsm.so, Bun builder, runtime with socat/vsock bridge)
- **D** ✅ — AWS Nitro Enclave deployment on EC2 — working! Real attestation documents returned.
- **E** ✅ — Deployment runbook & debugging guide (`docs/nitro-deployment.md`)

**Lessons learned**: See `lessons/phase-5d-nitro-enclave-deployment.md`

**Key fix**: `ifconfig lo 127.0.0.1` (not just `ip link set lo up`) — must assign the IP address, not just bring the link up.

---

## Phase 7: App Frontend Testing ✅ Complete

**Goal**: Proper test coverage for the app + restructure all test infrastructure.

**Completed:**
- **Unit tests**: 6 tests for app utility functions (`ui.ts`, `aztec.ts` state management)
- **Mocked E2E**: 8 Playwright tests (mode switching, TEE config panel, service dots, log panel) — no services needed
- **Fullstack E2E**: 12 Playwright tests (deploy, token flow, all 6 mode-switch combinations across remote/local/TEE) — requires Aztec + tee-rex
- **Test restructuring**: Eliminated `packages/integration/` — SDK owns its e2e in `packages/sdk/e2e/`, app owns its e2e in `packages/app/e2e/`
- **Playwright projects**: Single `playwright.config.ts` with `mocked` and `fullstack` projects (different timeouts, test patterns)
- **Assert-or-throw**: E2e tests fail (not skip) when services unavailable. TEE tests skip only when `TEE_URL` env var is not set.
- **Per-package CI**: `ci-sdk.yml`, `ci-app.yml`, `ci-server.yml` — no monolithic test workflow

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
- App Fullstack E2E job in `app.yml` — same infra + Playwright with chromium, runs `test:e2e:fullstack`
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

## Phase 12: Aztec Auto-Update CI (Golden Bow) ✅ Complete

**Goal**: CI pipeline that detects new Aztec spartan versions, updates deps, runs full test suite (including TEE), and opens a PR.

**Completed:**
- `scripts/check-aztec-spartan.ts` — checks npm `spartan` dist-tag, verifies all 11 `@aztec/*` packages exist at new version
- `scripts/update-aztec-version.ts` — updates 3 package.json + runs `bun install`
- `scripts/update-aztec-version.test.ts` — 12 unit tests for version validation, JSON/YAML update logic
- `.github/workflows/aztec-spartan.yml` — 3-job pipeline: check → update + unit test → create PR (with `test-tee` label + auto-merge)
- PR CI handles all testing: `sdk.yml`, `app.yml`, `server.yml` auto-trigger on the PR; `tee.yml` triggers on `test-tee` label
- Reusable workflows (`_deploy-tee.yml`, `_e2e-sdk.yml`, `_e2e-app.yml`) + composite actions (`setup-aztec`, `start-services`)
- `setup-aztec` auto-detects Aztec version from `packages/sdk/package.json` — no hardcoded versions in workflow files
- Auto-merge: `gh pr merge --auto --squash --delete-branch` merges when required status checks pass
- `bun run aztec:check` and `bun run aztec:update <version>` for local use

**TEE deployment (`_deploy-tee.yml` + `tee.yml`):**
- `tee.yml` triggers on PRs with `test-tee` label or manual dispatch
- `_deploy-tee.yml` builds `Dockerfile.nitro` with Docker layer caching (`docker/build-push-action` + `type=gha`) → pushes to ECR → starts EC2 → deploys enclave via SSM
- SDK/app e2e workflows accept optional `tee_url` input — each opens its own SSM tunnel to the already-running enclave
- Teardown job stops EC2 instance with `if: always()`
- AWS OIDC authentication (no stored secrets), IAM policy scoped by ECR repo ARN + EC2 `Environment: ci` tag
- SSM port forwarding: `localhost:4001 → EC2:4000` — no public port exposed
- Cost: ~$5/month (compute + EBS + ECR storage)

**AWS setup documentation:** `infra/iam/README.md` (OIDC provider, IAM role + policy, EC2 instance, GitHub secrets)

**PR-based CI architecture (gate job pattern):**
- Workflows always trigger on PRs (no `paths:` filter on `pull_request`) — avoids GitHub's "pending forever" problem with required checks
- Each workflow has a `changes` detection job using `gh pr diff` (API-based, works in shallow clones)
- Downstream jobs conditional on `needs.changes.outputs.relevant == 'true'`
- Gate jobs (`SDK Status`, `App Status`, `Server Status`) always run and check all results including `changes.result`
- GitHub ruleset requires only the 3 gate jobs — they pass (skipped = ok) when no relevant files changed
- For push/dispatch events, `changes` always returns `relevant=true` (path filter on `push:` trigger handles filtering)
- PRs created by spartan workflow use `PAT_TOKEN` (not `GITHUB_TOKEN`) to trigger other workflows

**Branch protection:** `infra/rulesets/main-branch-protection.json` — 3 required checks (SDK Status, App Status, Server Status). Import via GitHub Settings > Rules > Rulesets.

**Verified end-to-end:** Auto-update detected new version → created PR #15 → all workflows triggered → SDK/App/Server/TEE passed → auto-merged.

**12B — Multi-network support: ✅ Complete**
- `AZTEC_NODE_URL` env var configurable across app (Vite proxy target), e2e fixtures (health check), and CI
- `setup-aztec` action: `skip_cli` input skips Foundry + Aztec CLI install when targeting remote node
- `start-services` action: `aztec_node_url` input — local Aztec startup conditional, health check uses configured URL
- `_e2e-sdk.yml` / `_e2e-app.yml`: accept and propagate `aztec_node_url` to setup-aztec, start-services, and test env
- App frontend: no longer blocks on tee-rex server being down — defaults to local mode, wallet init proceeds with just the Aztec node
- App services panel: `#aztec-url` display updates dynamically from `AZTEC_NODE_URL` env var

**12B' — Nightly → Spartan migration: ✅ Complete**
- Renamed `scripts/check-aztec-nightly.ts` → `scripts/check-aztec-spartan.ts` (checks `spartan` dist-tag)
- `scripts/update-aztec-version.ts` — dual patterns: `VERSION_PATTERN` (spartan only, for validation) + `AZTEC_VERSION_PATTERN` (nightly|spartan, for matching deps to replace during transition)
- Renamed `.github/workflows/aztec-nightly.yml` → `.github/workflows/aztec-spartan.yml`
- Branch names: `chore/aztec-nightly-*` → `chore/aztec-spartan-*`
- Updated root `package.json` script, IAM README, test expectations
- First run: trigger spartan workflow manually with `version: 4.0.0-spartan.20260210` to bootstrap from nightly to spartan

**12C — Nextnet support in app frontend: ✅ Complete (nextnet manual test pending)**
- App auto-detects live network via `nodeInfo.l1ChainId !== 31337`
- Sponsored FPC (Fee Paying Contract) set up on all networks — derives canonical address from artifact + salt=0, registers in PXE
- `deployTestAccount()`: uses `from: AztecAddress.ZERO` + sponsored fee on live networks (self-deploy path), sandbox uses pre-registered accounts
- `runTokenFlow()`: all `.send()` calls include sponsored fee; deploys bob inline if only 1 account exists
- `proverEnabled: true` passed to PXE config on live networks (real proofs required)
- Network indicator in services panel ("sandbox" / "live")
- Auto-clears stale IndexedDB on init failure (handles Aztec version upgrades gracefully, retries up to 3 times)
- Validated on local sandbox. Nextnet manual test blocked — nextnet currently broken, will test when fixed
- Uses `aztec_node_url` input wired in 12B to skip local CLI install and point tests at nextnet

**12D — npm publish + git tags:**
- After green tests on main, automatically publish `@alejoamiras/tee-rex` (SDK only) to npm (public)
- Tag the release with the version number
- Triggered after spartan auto-merge or manual dispatch

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

**Goal**: Restructure SDK e2e tests to match the app's elegant pattern — test TEE mode and mode switching, with TEE tests skipping gracefully when `TEE_URL` isn't set.

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

## Phase 16: Abstract `PROVER_URL` (like `AZTEC_NODE_URL`) ✅ Complete

**Goal**: Make the non-TEE tee-rex server URL configurable everywhere, following the same pattern as `AZTEC_NODE_URL`. Rename from the hardcoded `LOCAL_TEEREX_URL` to `PROVER_URL`.

**Completed:**
- **`packages/app/vite.config.ts`** — `/prover` proxy route using `env.PROVER_URL || "http://localhost:4000"`
- **`packages/app/src/aztec.ts`** — `PROVER_URL = "/prover"` (proxied) + `PROVER_DISPLAY_URL` for services panel
- **`packages/app/e2e/fullstack.fixture.ts`** — Uses `process.env.PROVER_URL || "http://localhost:4000"`
- **`packages/sdk/e2e/e2e-setup.ts`** — `proverUrl` from `process.env.PROVER_URL || "http://localhost:4000"`
- **`.github/actions/start-services/action.yml`** — `prover_url` input with configurable health check
- **`.github/workflows/_e2e-sdk.yml` / `_e2e-app.yml`** — `prover_url` input propagated to `start-services` and test env
- `LOCAL_TEEREX_URL` and `TEEREX_URL` fully removed from codebase

---

## Phase 17: Auto-Deploy Pipeline

**Goal**: After the aztec-spartan auto-update PR passes all tests (including deployed prover + TEE), auto-merge and deploy everything to production. Nightly auto-updates keep the live system current with zero manual intervention.

**Decision**: No custom domain. Use **CloudFront** as the single entry point — serves the static app from S3 and proxies to EC2 backends. One `https://d1234abcd.cloudfront.net` URL, same-origin, no CORS, no mixed content, no domain needed.

**Architecture:**

```
aztec-spartan.yml detects new version
         │
         ▼
    Creates PR with labels: test-tee + test-remote
         │
    ┌────┴──────────────────────────────────┐
    │  CI runs on PR:                        │
    │  sdk.yml, app.yml, server.yml (unit)   │
    │  tee.yml (deploy CI TEE, run e2e)      │
    │  remote.yml (deploy CI prover, e2e)    │  ← NEW
    └────┬──────────────────────────────────┘
         │ all green → auto-merge to main
         ▼
    deploy-prod.yml (triggers on push to main)
    ┌────┬────┬────┐
    │    │    │    │
    ▼    ▼    ▼    ▼
  TEE   Prover  App   SDK
  EC2   EC2     S3    npm

    CloudFront (https://d1234abcd.cloudfront.net)
      ├── /*           → S3 bucket (static Vite build)
      ├── /prover/*    → Prover EC2 (http, port 80)
      └── /tee/*       → TEE EC2 (http, port 4000)
```

**Parts (ordered for incremental delivery):**

### 17A — Validate non-TEE `Dockerfile` ✅ Complete

**Completed:**
- Fixed missing `packages/app/package.json` COPY in Dockerfile (was breaking `bun install --frozen-lockfile` because root workspace references app)
- Added `curl` to system dependencies for healthcheck
- Added `HEALTHCHECK --interval=30s --timeout=5s --retries=3` that pings `/attestation`
- Built image (`docker build -t tee-rex --platform linux/amd64 .`) — succeeds
- Verified `GET /encryption-public-key` returns `{publicKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----..."}`
- Verified `GET /attestation` returns `{mode: "standard", publicKey: "..."}`
- Docker healthcheck reports `healthy`

**Fix applied:** The Nitro Dockerfile already had `COPY packages/app/package.json ./packages/app/` — the standard Dockerfile was missing it.

### 17B — `test-remote` label + `remote.yml` workflow

Mirror `tee.yml` but for the non-TEE prover. Pre-production testing of the prover container on a real EC2:

1. **`remote.yml`** — Triggers on PR with `test-remote` label or manual dispatch
2. **`_deploy-prover.yml`** (reusable) — Build standard `Dockerfile` → push to ECR → start CI EC2 → deploy container → health check
3. SDK + App e2e run against the deployed prover via SSM tunnel (same pattern as TEE: `localhost:4002 → EC2:80`)
4. Teardown stops EC2 instance
5. Uses a second EC2 instance (tagged `Environment: ci`, `Service: prover`) — no Nitro needed, can be smaller/cheaper

### 17C — `aztec-spartan.yml` adds labels

Update the spartan workflow to add both `test-tee` and `test-remote` labels to auto-generated PRs. This ensures every Aztec version update gets full pre-production testing against both deployed servers before merging.

### 17D — Production EC2 instances + `deploy-prod.yml`

Provision production infrastructure and deploy on merge to main:

1. **Production EC2 for TEE** — Nitro-capable, `m5.xlarge` or bigger, tagged `Environment: prod`
2. **Production EC2 for prover** — Standard instance, smaller (`t3.xlarge` or `c6a.xlarge`), tagged `Environment: prod`
3. **Elastic IPs** on both (stable addresses for CloudFront origins)
4. **IAM policy update** — Allow deploying to `Environment: prod` tagged instances (trust policy already allows `main` branch)
5. **`deploy-prod.yml`** — Triggers on push to main. Three parallel jobs:
   - Deploy TEE: `Dockerfile.nitro` → ECR → prod TEE EC2 → deploy enclave
   - Deploy Prover: `Dockerfile` → ECR → prod prover EC2 → start container
   - Publish SDK: npm publish (existing `publish-sdk.yml` logic)

### 17E — CloudFront + S3 for production app

Last step — wire up the public-facing infrastructure:

1. **S3 bucket** for the static Vite build (`packages/app/dist`)
2. **CloudFront distribution** with three origins:
   - Default (`/*`) → S3 bucket (static files)
   - `/prover/*` → Prover EC2 Elastic IP (HTTP, port 80). Origin response timeout: 180s (proving is slow)
   - `/tee/*` → TEE EC2 Elastic IP (HTTP, port 4000). Origin response timeout: 180s
3. **App build** uses relative paths (`/prover/prove`, `/tee/attestation`) — same as dev mode with Vite proxies
4. **`deploy-prod.yml`** adds a fourth job: `bun run --cwd packages/app build && aws s3 sync dist/ s3://<bucket>`
5. CloudFront invalidation after S3 sync to bust cache

**CloudFront benefits:**
- `https://d1234abcd.cloudfront.net` — free HTTPS, no domain, no certs to manage
- Same-origin for all requests — no CORS, no mixed content
- Free tier: 1TB transfer + 10M requests/month
- Origin timeout up to 180s (handles proving requests)
- Global CDN for the static app

**Cost estimate:**
- CloudFront: Free tier covers demo usage; ~$0.085/GB beyond 1TB
- S3: Pennies/month for a static site
- EC2 prod instances: Same as CI instances (stopped when not deploying — or kept running for live access)
- Total additional cost: ~$5-15/month on top of existing EC2 costs

---

## Backlog

- Phase 6 (next-net testing) absorbed into Phase 12B/12C
- Phase 11 benchmarking (instance sizing) — tackle when proving speed becomes a bottleneck
- ~~**IAM trust policy audit**~~ ✅ Done — tightened `tee-rex-ci-trust-policy.json` from `refs/heads/*` to `refs/heads/main` + `refs/heads/chore/aztec-spartan-*` + `pull_request`. **Note**: apply the updated policy to AWS with `aws iam update-assume-role-policy --role-name tee-rex-ci-github --policy-document file://infra/iam/tee-rex-ci-trust-policy.json`

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
