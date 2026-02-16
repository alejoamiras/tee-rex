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
- **CI**: GitHub Actions (per-package workflows with gate jobs: `sdk.yml`, `app.yml`, `server.yml`; spartan: `aztec-spartan.yml`; infra: `infra.yml` (combined TEE+Remote), `tee.yml`, `remote.yml`; deploy: `deploy-prod.yml`, `deploy-devnet.yml`; reusable: `_build-base.yml`, `_deploy-tee.yml`, `_deploy-prover.yml`, `_publish-sdk.yml`)
- **Testing**: Each package owns its own unit tests (`src/`) and e2e tests (`e2e/`). E2e tests fail (not skip) when services unavailable.
- **Test structure convention**: Group tests under the subject being tested, nest by variant — don't create separate files per variant when they share setup. Example: `describe("TeeRexProver")` > `describe("Remote")` / `describe("Local")` / `describe.skipIf(...)("TEE")`. Extract shared logic (e.g., `deploySchnorrAccount()`) into helpers within the file.
- **Aztec version**: 4.0.0-spartan.20260214

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

### 4. Test coverage

For every roadmap task, before starting implementation:

- **Read existing tests** for the packages you're modifying (`src/*.test.ts` for unit, `e2e/` for integration/Playwright)
- **Evaluate whether your changes need new or updated tests** — ask: "does this change behavior that existing tests cover? Does it add new behavior that should be tested?"
- **Skip adding tests only for truly miscellaneous changes** (docs-only, comments, config tweaks with no behavioral impact)
- **Add tests incrementally** — write the test alongside or immediately after the code change, not as a batch at the end

### 5. Validation

Every step must include a validation strategy. Think about how to verify the step worked:

- **Code changes**: run `bun run lint` and `bun run test`
- **New tests**: run the specific test file (`bun test path/to/file.test.ts`) and verify it passes
- **Refactors**: run the full test suite to catch regressions
- **Config changes**: run the relevant command (e.g., `bun install`, `bun run build`)
- **New features**: write a test or run a manual verification script

If you're unsure how to validate a step, that's a sign the step might be too big — break it down further.

### 6. Branch, commit & CI

When the work is complete and validated locally:

1. **Create a feature branch** from `main` using commitlint-friendly naming (e.g., `feat/feature-name`, `fix/bug-name`, `refactor/description`)
2. **Commit** with a conventional commit message (`feat:`, `fix:`, `refactor:`, `ci:`, `docs:`, etc.)
3. **Push** and create a PR via `gh pr create`
4. **Watch the CI run** with `gh pr checks <PR_NUMBER> --watch` — do not walk away assuming it passes
5. **If CI fails**: evaluate the failure, fix, push, and watch again — repeat until all checks pass

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

# Run nextnet smoke test (requires internet)
bun run test:e2e:nextnet

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

## Completed Phases (1–14, 16, 17F–G, 18A–C, 19, 20A–B, 21, 22, 23A–B)

| Phase | Summary |
|---|---|
| **1** | Monorepo migration to Bun workspaces (from pnpm/turbo) |
| **2** | Integration test suite with `bun test` (later moved to `packages/sdk/e2e/`) |
| **3** | Structured logging with LogTape (zero `console.log`, library-first SDK pattern) |
| **4A-D** | Unit tests (20), E2E tests (21), demo frontend (3 proving modes), full token flow demo |
| **5A-E** | Nitro Enclave attestation — SDK verifies COSE_Sign1, server FFI to libnsm.so, Dockerfile.nitro, deployed on EC2. Key fix: `ifconfig lo 127.0.0.1`. Lessons: `lessons/phase-5d-nitro-enclave-deployment.md` |
| **7** | App frontend testing — 6 unit, 8 mocked Playwright, 12 fullstack Playwright. Test restructure: SDK e2e in `packages/sdk/e2e/`, app e2e in `packages/app/e2e/` |
| **8** | Repo rename `nemi-fi` → `alejoamiras` (15+ files) |
| **9** | CI granular parallel jobs (Lint, Typecheck, Unit, E2E per package) |
| **10** | E2E CI with Aztec local network (Foundry + Aztec CLI, cached by version) |
| **12** | Aztec auto-update CI — spartan version detection → PR → full test suite (incl. TEE) → auto-merge. Gate job pattern, reusable workflows, composite actions. `PAT_TOKEN` for PR-triggered workflows. Branch protection: 3 gate jobs. |
| **12B** | Multi-network support (`AZTEC_NODE_URL` configurable across app/CI/e2e) |
| **12B'** | Nightly → Spartan dist-tag migration |
| **12C** | Nextnet/live network support — sponsored FPC, auto-detect chain ID, `proverEnabled: true` |
| **13** | OpenPGP encryption review — keep everywhere, upgraded to curve25519 + AES-256-GCM (SEIPDv2) |
| **14** | SDK e2e restructure — single `proving.test.ts` with nested describes, TEE `describe.skipIf`, mode-switching tests |
| **16** | `PROVER_URL` abstraction (like `AZTEC_NODE_URL`) — configurable everywhere, Vite proxy, CI inputs |
| **18A** | Optional remote/TEE modes via env vars. `PROVER_CONFIGURED` / `TEE_CONFIGURED` feature flags (from `PROVER_URL` / `TEE_URL` at build time). Buttons start disabled in HTML, JS enables when configured. `/prover` and `/tee` Vite proxies conditional. Service panel labels: "not configured" / "available" / "unavailable" / "attested". Fullstack e2e skip guards for remote/TEE. `deploy-prod.yml` passes `TEE_URL` to app build. |
| **18B** | Granular benchmark UI — `NO_WAIT` + `waitForTx()` polling for prove+send/confirm sub-timings |
| **18C** | Attribution update — footer changed to "inspired by nemi.fi" |
| **19** | Dependency updates — 20 non-Aztec packages across 4 risk-based batches |

**Key architectural decisions (from completed phases):**
- CI gate job pattern: workflows always trigger on PRs, `changes` job uses `dorny/paths-filter@v3` for declarative path-based change detection, gate jobs (`SDK/App/Server Status`) always run. `workflow_dispatch` overrides filters to `true`. Full CI reference: `docs/ci-pipeline.md`. Ruleset: `infra/rulesets/main-branch-protection.json`
- AWS OIDC auth (no stored keys), IAM scoped to ECR repo + `Environment` tag. Setup: `infra/iam/README.md`
- **Infra files use placeholders** (`<ACCOUNT_ID>`, `<DISTRIBUTION_ID>`, `<OAC_ID>`, `<PROVER_EC2_DNS>`, `<TEE_EC2_DNS>`, etc.) for sensitive AWS resource IDs. **Before using any infra JSON/command**, substitute real values via `sed` or manually. See `infra/iam/README.md` and `infra/cloudfront/README.md` for instructions.
- SSM port forwarding for EC2 access (no public ports). TEE: local:4001→EC2:4000, Prover: local:4002→EC2:80
- SDK e2e structure: `e2e-setup.ts` (preload), `connectivity.test.ts`, `proving.test.ts` (Remote/Local/TEE), `mode-switching.test.ts`, `nextnet.test.ts` (connectivity smoke, auto-skipped on local)
- SDK e2e tests are network-agnostic: always use Sponsored FPC + `from: AztecAddress.ZERO` (no `registerInitialLocalNetworkAccountsInWallet`)
- CI test workflows (`sdk.yml`, `app.yml`, `server.yml`) only trigger on PRs + manual dispatch — no push-to-main triggers (deploy-prod.yml handles post-merge)
- **SDK publish pipeline**: `npm version` doesn't work in Bun workspaces (`workspace:*` protocol error) — use `node -e` to set version. `npm publish --provenance` requires `repository.url` in package.json matching the GitHub repo. YAML `if:` expressions with colons must be double-quoted. `workflow_dispatch` can trigger publish-sdk for retries.
- **EC2 deploy**: Use `instance-status-ok` (2/2 checks) instead of `instance-running` for SSM readiness. SSM agent needs the OS fully booted + IAM instance profile with `AmazonSSMManagedInstanceCore`.
- App e2e: Playwright with `mocked` + `fullstack` projects. Mocked tests set `PROVER_URL` via playwright.config env so `PROVER_CONFIGURED=true`. Fullstack tests skip remote/TEE describes when their env vars are not set.
- Env-var-driven feature flags: `PROVER_CONFIGURED = !!process.env.PROVER_URL`, `TEE_CONFIGURED = !!process.env.TEE_URL`. Buttons start `disabled` in HTML; JS enables them when configured + reachable/attested. Service row labels default to "not configured" in HTML.
- **GHA workflow outputs cannot contain secrets**: GitHub masks any output whose value contains a secret string — the output silently becomes empty. Pass non-secret identifiers (e.g. image tags) and reconstruct full URIs in consuming jobs.
- **Multi-stage Dockerfile `ARG`**: `--build-arg` only reaches global-scope `ARG` (before any `FROM`). Must re-declare `ARG` inside each stage that uses it.
- **Docker prune ordering**: `docker image prune -af` deletes images not referenced by running containers. TEE deploy reads images via `nitro-cli` (no container), so prune must follow EIF build. Prover deploy starts a container first, protecting the image.

---

## Phase 17: Auto-Deploy Pipeline

**Goal**: After the aztec-spartan auto-update PR passes all tests (including deployed prover + TEE), auto-merge and deploy everything to production. Nightly auto-updates keep the live system current with zero manual intervention.

**Decision**: No custom domain. Use **CloudFront** as the single entry point — serves the static app from S3 and proxies to EC2 backends. One `https://d1234abcd.cloudfront.net` URL, same-origin, no CORS, no mixed content, no domain needed.

**Architecture:**

```
aztec-spartan.yml detects new version
         │
         ▼
    Creates PR with label: test-infra
         │
    ┌────┴──────────────────────────────────┐
    │  CI runs on PR:                        │
    │  sdk.yml, app.yml, server.yml (unit)   │
    │  infra.yml (deploy TEE + prover, e2e)  │
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

**Completed parts:**

| Part | Summary |
|---|---|
| **17A** | Fixed non-TEE `Dockerfile` (missing `packages/app/package.json` COPY, added healthcheck + curl) |
| **17B** | `remote.yml` + `_deploy-prover.yml` — CI prover deploy on `test-remote` label. `infra/ci-deploy-prover.sh`. CI EC2: `t3.xlarge` |
| **17C** | Spartan workflow adds `test-infra` label to auto PRs (combined TEE + Remote deploy + e2e via `infra.yml`). Individual `tee.yml` / `remote.yml` kept for isolated debugging via `test-tee` / `test-remote` labels. |
| **17D** | `deploy-prod.yml` (push to main → deploy TEE + prover to prod). `_deploy-tee.yml` / `_deploy-prover.yml` parameterized with `environment` + `image_tag` inputs. IAM: `Environment: ["ci", "prod"]`. Prod EC2: TEE `m5.xlarge` + prover `t3.xlarge` with Elastic IPs. Secrets: `PROD_TEE_INSTANCE_ID`, `PROD_PROVER_INSTANCE_ID` |
| **17E** | CloudFront + S3 for production app. S3 bucket `tee-rex-app-prod` (OAC, private). CloudFront distribution `<DISTRIBUTION_ID>` with 3 origins: S3 (default), prover EC2 (`/prover/*`), TEE EC2 (`/tee/*`). CF Function strips path prefixes. COOP/COEP response headers policy. `deploy-prod.yml` has `deploy-app` job (build + S3 sync + CF invalidation). SG rule: CloudFront prefix list for ports 80-4000. IAM: S3 + CF invalidation permissions. Secrets: `PROD_S3_BUCKET`, `PROD_CLOUDFRONT_DISTRIBUTION_ID`, `PROD_CLOUDFRONT_URL`. Setup docs: `infra/cloudfront/README.md`. |
| **17F** | Nextnet connectivity smoke test (`nextnet.test.ts`) + `nextnet-check` job in `deploy-prod.yml` as pre-publish gate. `validate-prod` job runs app fullstack e2e against nextnet after all deploys complete (SSM tunnels to prod TEE + prover). |
| **17G** | SDK auto-publish in `deploy-prod.yml`. `publish-sdk` job triggers on spartan auto-update merges (`chore: update @aztec/*`), reads Aztec version from `@aztec/stdlib` dep, sets SDK version to match, publishes to npm with `--tag spartan` + `--provenance`, creates git tag + GitHub release. Gated by `nextnet-check`. Uses OIDC trusted publishing (no `NPM_TOKEN`). Configure at: `https://www.npmjs.com/package/@alejoamiras/tee-rex/access`. |

---

## Phase 18: Frontend Improvements

**Goal**: Polish the app UX — auto-configure TEE, granular benchmarks, attribution update.

**18A — Optional remote/TEE via env vars:** DONE (PR #31)
- `PROVER_URL` and `TEE_URL` env vars control whether remote/TEE modes are available
- `PROVER_CONFIGURED` / `TEE_CONFIGURED` boolean exports in `aztec.ts`
- Buttons start `disabled` in HTML; `main.ts` enables when configured (remote) or configured+attested (TEE)
- `/prover` and `/tee` Vite proxies only created when env vars are set
- Service panel rows: "not configured" (default) / "available" / "unavailable" / "attested" / "unreachable"
- Removed TEE manual URL input + Check button — TEE auto-configures from env
- `deploy-prod.yml` passes `TEE_URL` to app build
- Fullstack e2e skip guards: remote tests skip when `PROVER_URL` not set

**18B — Granular benchmark UI:** DONE (PR #37)
- Break `.send()` into two timed phases using `NO_WAIT` + `waitForTx()` polling: prove+send and confirm
- Added `proveSendMs` / `confirmMs` optional fields to `StepTiming` interface
- `waitForTx()` helper polls `getTxReceipt()` every 1s, throws on dropped txs
- All send operations in `deployTestAccount()` and `runTokenFlow()` refactored to capture sub-timings
- For token deploy, uses `TokenContract.at()` after confirm (address deterministic from simulate)
- UI renders "prove + send" and "confirm" sub-rows alongside existing simulation details in step breakdown

**18C — Attribution update:** DONE
- Changed footer from `tee-rex · nemi.fi` to `tee-rex · inspired by nemi.fi`

---

## Phase 19: Dependency Updates — DONE (PR #38)

Updated 20 non-Aztec packages across 4 risk-based batches. Skipped `zod` (v4 incompatible with `@aztec/stdlib` Zod 3 schemas).

---

## Phase 20: Deploy Pipeline Optimization

**Goal**: Speed up the deploy-prod pipeline and eliminate disk space fragility on EC2 instances.

**Current state**: Deploy scripts wipe `/var/lib/docker` entirely on every deploy because the EBS volumes are too small to keep cached layers. This forces a full image pull (~2GB) every time and makes deploys slow. EC2 startup now uses `instance-status-ok` (2/2 checks) + 10 min SSM timeout with diagnostics on failure.

**20A — Increase EBS volumes + replace nuclear Docker cleanup:** DONE (PR #45)
- Resized all 4 EC2 EBS volumes from 8GB to 20GB (`aws ec2 modify-volume` + `growpart` / cloud-init auto-grow)
- Replaced nuclear Docker cleanup (`systemctl stop docker && rm -rf /var/lib/docker/*`) with `docker system prune -af` in `infra/ci-deploy.sh` and `infra/ci-deploy-prover.sh`
- Docker layer cache now persists between deploys — pulls only changed layers instead of full ~2GB
- Validated via CI: Remote Prover deploy + e2e (green), TEE deploy + e2e (green)

**20B — Split Docker image into base + app layers:** DONE (PRs #46, #48, #49, #51)
- `Dockerfile.base`: shared base image (Bun + system deps + `bun install` ~2.4GB), tagged `tee-rex:base-<aztec-version>` in ECR
- `Dockerfile` (prover) and `Dockerfile.nitro` stage 2 (builder): `ARG BASE_IMAGE` / `FROM ${BASE_IMAGE}`, removed dep install layers
- `_build-base.yml`: idempotent reusable workflow — reads Aztec version, checks ECR, builds+pushes only if missing. ECR registry cache. Outputs `base_tag` (not full URI — see lessons).
- `_deploy-tee.yml` / `_deploy-prover.yml`: accept `base_tag` input, construct full URI internally from `ECR_REGISTRY` secret + tag, ECR registry cache (bundles Phase 20D)
- `deploy-prod.yml`, `tee.yml`, `remote.yml`: added `ensure-base` job before deploy jobs
- Deploy scripts: reordered for layer caching. `ci-deploy-prover.sh`: stop → pull → run container → prune (container protects image). `ci-deploy.sh`: teardown → pull → build EIF → prune → run enclave (EIF build needs image on disk).
- Local build scripts: two-step `build:base` + `build` / `build:nitro` in root `package.json`
- **CI lessons (critical)**:
  1. **GHA secret masking on outputs**: Workflow outputs containing secret values (e.g. ECR registry URI) are silently redacted to empty string. Warning: `Skip output 'X' since it may contain secret.` Fix: output only non-secret parts (e.g. image tag) and let consumers reconstruct the full value from their own secrets.
  2. **Multi-stage Dockerfile `ARG` scoping**: `--build-arg` only populates `ARG` declarations at global scope (before the first `FROM`). In multi-stage builds, add a global `ARG` before stage 1, then re-declare it inside the stage that uses it (e.g. `ARG BASE_IMAGE` before `FROM rust AS nsm`, then again before `FROM ${BASE_IMAGE} AS builder`).
  3. **`docker image prune -af` vs `nitro-cli`**: Prune deletes all images not referenced by running containers. For TEE deploys, `nitro-cli build-enclave` reads the Docker image directly (no container), so prune must happen **after** EIF build. For prover deploys, `docker run` starts the container first, protecting the image from prune.

**~~20C — Early health check endpoint:~~** Removed — server already listens immediately. `ProverService` initializes asynchronously (`setTimeout`), `/attestation` doesn't depend on it.

**~~20D — ECR registry cache for Docker builds:~~** Bundled into 20B

**~~20E — Pre-build EIF in CI (research):~~** Cancelled — diminishing returns after 20A+20B optimizations. `nitro-cli` requires a Nitro instance anyway.

---

## Phase 21: Multi-Region Strategy (Research) — DONE

**Goal**: Research deploying TEE, prover, and frontend across multiple AWS regions (closest to Argentina + London offices). **Research only — no implementation.**

**Research doc**: `lessons/phase-21-multi-region-research.md`

**Key findings:**
- **Regions**: sa-east-1 (São Paulo, ~30-50ms from Buenos Aires) + eu-west-2 (London, current)
- **Nitro Enclaves**: Supported in all AWS regions since Oct 2025 — no blockers for sa-east-1
- **ECR strategy**: Cross-region replication (configure once, push once to eu-west-2, auto-replicates to sa-east-1)
- **Geo-routing**: CloudFront Function rewrites paths based on `CloudFront-Viewer-Country` header. No custom domain needed. Add sa-east-1 origins as `/prover-sa/*` and `/tee-sa/*` cache behaviors.
- **IaC**: Keep shell scripts for MVP (1 new region). Adopt **OpenTofu** at 3+ regions — open-source Terraform fork (MPL 2.0), same HCL syntax/providers, `for_each` on providers for clean multi-region configs. Example at `infra/opentofu-example/`.
- **Cost**: +$160/month (prover-only MVP) to +$360/month (full dual-region). sa-east-1 has ~20-30% premium over eu-west-2.
- **Simplest MVP**: sa-east-1 prover + CloudFront geo-routing (~$160/month, ~8 hours effort). Prover-first because proving is the slowest operation and biggest UX win.

**Phased rollout (when ready to implement):**
1. **21A**: ECR cross-region replication (~1 hour)
2. **21B**: Deploy sa-east-1 prover (~4 hours)
3. **21C**: CloudFront geo-routing via CF Function (~4 hours)
4. **21D** *(optional)*: Deploy sa-east-1 TEE (~4 hours)
5. **21E**: Monitoring + validation (~2 hours)

---

## Phase 22: CI Change Detection & Conditional Deploys — DONE (PRs #57, #61)

**Goal**: Eliminate redundant CI work — skip unrelated PR test jobs and skip deploy-prod jobs for unchanged components.

**22A — Unified change detection with `dorny/paths-filter`:** DONE (PR #57)
- Replaced copy-pasted shell scripts (`gh pr diff` + grep loop) in `sdk.yml`, `app.yml`, `server.yml` with declarative `dorny/paths-filter@v3`
- Works for both `pull_request` and `push` events (the old scripts only worked for PRs)
- `workflow_dispatch` override step sets `relevant=true` to bypass filters on manual runs

**22B — Conditional deploy-prod:** DONE (PR #57)
- Added `changes` job to `deploy-prod.yml` with two outputs: `servers` and `app`
- `servers` filter: `packages/server/**`, `packages/sdk/**`, `Dockerfile*`, `infra/**`, `package.json`, `bun.lock`
- `app` filter: `packages/app/**`, `packages/sdk/**`, `package.json`, `bun.lock`
- `ensure-base`, `deploy-tee`, `deploy-prover` gated on `servers == 'true'`
- `deploy-app` gated on `app == 'true'`
- `validate-prod` runs when either changed (`!cancelled()` + OR condition)
- `nextnet-check` and `publish-sdk` remain ungated (independent of what changed)
- App-only merges now skip ~50 min of server deploys; workflow-only merges skip all deploys

**22C — CI pipeline documentation:** DONE (PR #61)
- Moved `lessons/ci-pipeline-audit.md` to `docs/ci-pipeline.md` as a living reference
- Covers all 15 workflow files with mermaid diagrams, change detection paths, conditional deploy logic, Docker image strategy, and key design decisions

---

## Phase 23: Devnet Support

**Goal**: Support a separate `devnet` deployment alongside production (`nextnet`/`spartan`). Long-lived `devnet` branch, `workflow_dispatch`-triggered deploy, own infrastructure. No auto-update — Aztec devnet versions are managed manually (cherry-pick from main or direct commits to `devnet` branch).

**Architecture:**

```
main branch (spartan/nextnet) → deploy-prod.yml (on push)     → prod EC2s + S3 + CF
devnet branch (devnet Aztec)  → deploy-devnet.yml (manual)    → devnet EC2s + S3 + CF

deploy-devnet.yml flow:
  workflow_dispatch
    → ensure-base
    → deploy-tee + deploy-prover (devnet EC2s)
    → e2e-sdk + e2e-app (against deployed devnet infra)  ← quality gate
    → deploy-app (devnet S3/CF)
    → publish-sdk (npm --tag devnet)  ← only if e2e green
```

No branch protection ruleset on `devnet` — the workflow itself is the quality gate. E2e must pass before app deploys and SDK publishes.

**Completed parts:**

| Part | Summary |
|---|---|
| **23A** | IAM templates updated: `refs/heads/devnet` in trust policy, `devnet` in Environment tags / S3 / CloudFront. `_deploy-tee.yml` / `_deploy-prover.yml` extended with devnet instance ID resolution. AWS provisioning (EC2, S3, CF, secrets) done via CLI after merge. |
| **23B** | `deploy-devnet.yml`: `workflow_dispatch`-only pipeline. Jobs: `ensure-base` → `deploy-tee` + `deploy-prover` → `validate-devnet` (blocking SSM tunnels + SDK e2e + app fullstack e2e) → `deploy-app` + `publish-sdk`. Extracted `_publish-sdk.yml` reusable workflow (parameterized `dist_tag` + `latest`) — `deploy-prod.yml` refactored to call it with `spartan`/`true`, devnet calls with `devnet`/`false`. Git tag `|| true` handles same-version edge case. |

**Remaining:**

**23C — Create `devnet` branch:**
- Branch from `main`, update Aztec deps to devnet version, update `AZTEC_NODE_URL` references
- First `workflow_dispatch` run validates the full pipeline

---

## Backlog

- Phase 6 (next-net testing) absorbed into Phase 12B/12C, further work in Phase 17F
- Phase 11 benchmarking (instance sizing) — tackle when proving speed becomes a bottleneck
- Phase 15 TEE generalization research (TeeProvider interface) — tackle after core features stabilize
- **Gate `publish-sdk` on `validate-prod` instead of `nextnet-check`** — Currently `nextnet-check` (3 lightweight API calls, ~1 min) gates SDK publishing as a cheap pre-flight. The real validation is `validate-prod` (full Playwright e2e against prod servers + nextnet, ~30-60 min) but it has `continue-on-error` and is too slow/fragile to be a hard gate today. The proper fix: (1) extract `publish-sdk` into a reusable `_publish-sdk.yml` so it can be called from `deploy-prod.yml` after validation AND triggered standalone via `workflow_dispatch` for retries without re-running deploys, (2) make `publish-sdk` depend on `validate-prod` instead of `nextnet-check` for auto-update merges, (3) handle `continue-on-error` carefully — either remove it and accept that nextnet outages block publishes, or check `validate-prod`'s actual conclusion/outcome instead of its result. Tradeoff: more correct but slower, and nextnet outages would block auto-update SDK publishes until the network recovers.
- ~~**IAM trust policy audit**~~ ✅ Done — tightened `tee-rex-ci-trust-policy.json` from `refs/heads/*` to `refs/heads/main` + `refs/heads/chore/aztec-spartan-*` + `pull_request`. **Note**: apply the updated policy to AWS with `aws iam update-assume-role-policy --role-name tee-rex-ci-github --policy-document file://infra/iam/tee-rex-ci-trust-policy.json`

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
