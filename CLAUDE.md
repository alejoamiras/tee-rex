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

## Completed Phases (1–14, 16, 18A)

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

**Key architectural decisions (from completed phases):**
- CI gate job pattern: workflows always trigger on PRs, `changes` job detects relevant files via `gh pr diff`, gate jobs (`SDK/App/Server Status`) always run. Ruleset: `infra/rulesets/main-branch-protection.json`
- AWS OIDC auth (no stored keys), IAM scoped to ECR repo + `Environment` tag. Setup: `infra/iam/README.md`
- **Infra files use placeholders** (`<ACCOUNT_ID>`, `<DISTRIBUTION_ID>`, `<OAC_ID>`, `<PROVER_EC2_DNS>`, `<TEE_EC2_DNS>`, etc.) for sensitive AWS resource IDs. **Before using any infra JSON/command**, substitute real values via `sed` or manually. See `infra/iam/README.md` and `infra/cloudfront/README.md` for instructions.
- SSM port forwarding for EC2 access (no public ports). TEE: local:4001→EC2:4000, Prover: local:4002→EC2:80
- SDK e2e structure: `e2e-setup.ts` (preload), `connectivity.test.ts`, `proving.test.ts` (Remote/Local/TEE), `mode-switching.test.ts`
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

**Remaining:**

| Part | Summary |
|---|---|
| **17F** | Nextnet E2E testing — run SDK e2e and app fullstack e2e against nextnet (not just local network). Consider adding nextnet to the `test-tee` / `test-remote` CI labels so spartan auto-update PRs also validate against a live network. |
| **17G** | SDK npm publish — add `publish-sdk` job to `deploy-prod.yml` (npm publish on push to main, version bump strategy TBD). |

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

**18B — Granular benchmark UI:**
- Add sub-step timing to deploy and token flow operations (witness generation, proving, tx send/confirm)
- Display in a collapsible section under each result card to avoid UI clutter
- Track: witness gen time, IVC proof time, tx submission time, tx confirmation time
- Requires instrumenting `aztec.ts` deploy/token flow functions with finer-grained timing

**18C — Attribution update:**
- Change footer from `tee-rex · nemi.fi` to `tee-rex · inspired by nemi.fi`

---

## Phase 19: Dependency Updates

**Goal**: Update all non-Aztec dependencies to latest versions.

- Use `ncu` (npm-check-updates, already installed) to detect outdated packages
- **Do NOT update `@aztec/*` packages** — those are managed by the spartan auto-update workflow
- For each update: check the package's changelog/npm page for breaking changes
- Run full test suite (`bun run test` + `bun run test:e2e`) after each batch of updates
- Batch by risk: patch updates first, then minor, then major (one at a time for majors)

---

## Phase 20: Multi-Region Strategy (Research)

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
