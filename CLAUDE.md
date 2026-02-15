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

## Completed Phases (1–14, 16, 17F–G, 18A–C, 19)

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
- CI gate job pattern: workflows always trigger on PRs, `changes` job detects relevant files via `gh pr diff`, gate jobs (`SDK/App/Server Status`) always run. Ruleset: `infra/rulesets/main-branch-protection.json`
- AWS OIDC auth (no stored keys), IAM scoped to ECR repo + `Environment` tag. Setup: `infra/iam/README.md`
- **Infra files use placeholders** (`<ACCOUNT_ID>`, `<DISTRIBUTION_ID>`, `<OAC_ID>`, `<PROVER_EC2_DNS>`, `<TEE_EC2_DNS>`, etc.) for sensitive AWS resource IDs. **Before using any infra JSON/command**, substitute real values via `sed` or manually. See `infra/iam/README.md` and `infra/cloudfront/README.md` for instructions.
- SSM port forwarding for EC2 access (no public ports). TEE: local:4001→EC2:4000, Prover: local:4002→EC2:80
- SDK e2e structure: `e2e-setup.ts` (preload), `connectivity.test.ts`, `proving.test.ts` (Remote/Local/TEE), `mode-switching.test.ts`, `nextnet.test.ts` (connectivity smoke, auto-skipped on local)
- SDK e2e tests are network-agnostic: always use Sponsored FPC + `from: AztecAddress.ZERO` (no `registerInitialLocalNetworkAccountsInWallet`)
- CI test workflows (`sdk.yml`, `app.yml`, `server.yml`) only trigger on PRs + manual dispatch — no push-to-main triggers (deploy-prod.yml handles post-merge)
- App e2e: Playwright with `mocked` + `fullstack` projects. Mocked tests set `PROVER_URL` via playwright.config env so `PROVER_CONFIGURED=true`. Fullstack tests skip remote/TEE describes when their env vars are not set.
- Env-var-driven feature flags: `PROVER_CONFIGURED = !!process.env.PROVER_URL`, `TEE_CONFIGURED = !!process.env.TEE_URL`. Buttons start `disabled` in HTML; JS enables them when configured + reachable/attested. Service row labels default to "not configured" in HTML.

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

**Completed parts:**

| Part | Summary |
|---|---|
| **17A** | Fixed non-TEE `Dockerfile` (missing `packages/app/package.json` COPY, added healthcheck + curl) |
| **17B** | `remote.yml` + `_deploy-prover.yml` — CI prover deploy on `test-remote` label. `infra/ci-deploy-prover.sh`. CI EC2: `t3.xlarge` |
| **17C** | Spartan workflow adds `test-tee` + `test-remote` labels to auto PRs |
| **17D** | `deploy-prod.yml` (push to main → deploy TEE + prover to prod). `_deploy-tee.yml` / `_deploy-prover.yml` parameterized with `environment` + `image_tag` inputs. IAM: `Environment: ["ci", "prod"]`. Prod EC2: TEE `m5.xlarge` + prover `t3.xlarge` with Elastic IPs. Secrets: `PROD_TEE_INSTANCE_ID`, `PROD_PROVER_INSTANCE_ID` |
| **17E** | CloudFront + S3 for production app. S3 bucket `tee-rex-app-prod` (OAC, private). CloudFront distribution `<DISTRIBUTION_ID>` with 3 origins: S3 (default), prover EC2 (`/prover/*`), TEE EC2 (`/tee/*`). CF Function strips path prefixes. COOP/COEP response headers policy. `deploy-prod.yml` has `deploy-app` job (build + S3 sync + CF invalidation). SG rule: CloudFront prefix list for ports 80-4000. IAM: S3 + CF invalidation permissions. Secrets: `PROD_S3_BUCKET`, `PROD_CLOUDFRONT_DISTRIBUTION_ID`, `PROD_CLOUDFRONT_URL`. Setup docs: `infra/cloudfront/README.md`. |
| **17F** | Nextnet connectivity smoke test (`nextnet.test.ts`) + `nextnet-check` job in `deploy-prod.yml` as pre-publish gate. `validate-prod` job runs app fullstack e2e against nextnet after all deploys complete (SSM tunnels to prod TEE + prover). |
| **17G** | SDK auto-publish in `deploy-prod.yml`. `publish-sdk` job triggers on spartan auto-update merges (`chore: update @aztec/*`), reads Aztec version from `@aztec/stdlib` dep, sets SDK version to match, publishes to npm with `--tag spartan`, creates git tag + GitHub release. Gated by `nextnet-check`. Replaces manual `publish-sdk.yml` workflow. Requires `NPM_TOKEN` secret. |

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

**Current state**: Deploy scripts wipe `/var/lib/docker` entirely on every deploy because the EBS volumes are too small to keep cached layers. This forces a full image pull (~2GB) every time and makes deploys slow.

**20A — Increase TEE EC2 EBS volume:**
- Current root EBS is too small (~8GB?) — only 614M free after OS + Docker runtime
- Increase to 20GB so Docker can keep base layers cached between deploys
- Once disk is large enough, revert the nuclear `/var/lib/docker` wipe back to `docker system prune -af`
- This alone should cut TEE deploy time significantly (pull only changed layers instead of all ~2GB)

**20B — Split Docker image into base + app layers:**
- Create a base image (`tee-rex-base:spartan-YYYYMMDD`) with OS + Bun + `@aztec/*` packages
- App image (`tee-rex:prod`) uses `FROM tee-rex-base` + app code only
- Base image rebuilt only on Aztec version bumps (spartan auto-update)
- Most deploys would pull only the thin app layer (~MBs, not GBs)
- Works well even on small disks since the base image rarely changes

**20C — Early health check endpoint:**
- Server currently takes 5-10 minutes to respond to `/attestation` on cold boot (Aztec initialization)
- Add a lightweight `/healthz` endpoint that responds `200` as soon as Express is listening
- Use `/healthz` for the deploy health check (confirms container is running)
- Keep `/attestation` for readiness checks (confirms Aztec is fully initialized)
- Would reduce perceived deploy time and avoid false timeout failures

**20D — ECR registry cache for Docker builds:**
- Current: `cache-from: type=gha` / `cache-to: type=gha` — GitHub Actions cache has 10GB limit and can evict
- Switch to ECR as cache source: `cache-from: type=registry,ref=<ECR>/tee-rex:cache`
- More reliable, no size limit beyond ECR storage, faster for large images

**20E — Pre-build EIF in CI (research):**
- Currently: CI builds Docker → pushes to ECR → EC2 pulls → EC2 builds EIF → EC2 runs enclave
- If EIF could be built in CI and uploaded to S3, EC2 would skip pull + EIF build entirely
- Constraint: `nitro-cli build-enclave` requires a Nitro-capable instance — investigate if a CI SSM step could do this, or if there's an alternative approach

---

## Phase 21: Multi-Region Strategy (Research)

**Goal**: Research deploying TEE, prover, and frontend across multiple AWS regions (closest to Argentina + London offices). **Research only — no implementation.**

**Questions to answer:**
1. Which AWS regions are closest to Buenos Aires and London? (sa-east-1 São Paulo, eu-west-2 London)
2. Can we build Docker images once (in CI) and push to ECR in multiple regions? (ECR cross-region replication vs multi-push)
3. How to route users to the nearest region? (CloudFront multi-origin, Route 53 latency-based routing, CloudFront Functions geo-routing)
4. TEE (Nitro Enclaves) availability per region — are enclaves supported in sa-east-1?
5. Would Terraform/OpenTofu make sense for managing multi-region infra? (vs. current shell scripts + GitHub Actions)
6. Cost implications — running 2x EC2 instances, cross-region data transfer
7. What's the simplest MVP? (e.g., just add sa-east-1 prover + CloudFront latency routing, keep single TEE)

**Possible outcomes:**
- A concrete plan with estimated effort and cost
- Decision on IaC tool (Terraform vs current approach)
- Phased rollout plan (which component to multi-region first)

---

## Backlog

- Phase 6 (next-net testing) absorbed into Phase 12B/12C, further work in Phase 17F
- Phase 11 benchmarking (instance sizing) — tackle when proving speed becomes a bottleneck
- Phase 15 TEE generalization research (TeeProvider interface) — tackle after core features stabilize
- ~~**IAM trust policy audit**~~ ✅ Done — tightened `tee-rex-ci-trust-policy.json` from `refs/heads/*` to `refs/heads/main` + `refs/heads/chore/aztec-spartan-*` + `pull_request`. **Note**: apply the updated policy to AWS with `aws iam update-assume-role-policy --role-name tee-rex-ci-github --policy-document file://infra/iam/tee-rex-ci-trust-policy.json`

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
