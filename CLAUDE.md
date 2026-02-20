# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **Repo**: `alejoamiras/tee-rex` (GitHub)
- **SDK** (`/packages/sdk`): TypeScript package `@alejoamiras/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **App** (`/packages/app`): Vite + vanilla TS frontend — local/remote/TEE mode toggle, timing, token flow
- **Build system**: Bun workspaces (`packages/sdk`, `packages/server`, `packages/app`)
- **Linting/Formatting**: Biome (lint + format in one tool), shellcheck (shell scripts), actionlint (GitHub Actions workflows)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits). lint-staged runs Biome on `*.{ts,tsx,js,jsx}`, shellcheck on `*.sh`, and actionlint on `.github/workflows/*.yml`.
- **CI**: GitHub Actions (per-package workflows with gate jobs: `sdk.yml`, `app.yml`, `server.yml`; shell & workflow lint: `actionlint.yml`; spartan: `aztec-spartan.yml`; infra: `infra.yml` (combined TEE+Remote), `tee.yml`, `remote.yml`; deploy: `deploy-prod.yml`, `deploy-devnet.yml`; reusable: `_build-base.yml`, `_deploy-tee.yml`, `_deploy-prover.yml`, `_publish-sdk.yml`)
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
- **Real-data integration tests for external protocols** — when code processes data from external systems (attestation documents, CBOR/protobuf, API responses, binary protocols), **never rely solely on synthetic test data**. Synthetic tests verify logic; they don't verify assumptions about encoding. Always include at least one `describe.skipIf(!ENV_VAR)` integration test that runs against real production data. This catches mismatches between how libraries encode data (e.g., cbor-x BigInt vs number, tagged vs plain bstr, Map vs object) and what the code expects. See `attestation.test.ts` "Real Nitro attestation" for the pattern.

### 5. Validation

Every step must include a validation strategy. Think about how to verify the step worked:

- **Code changes**: run `bun run lint` and `bun run test`
- **Shell script changes**: run `bun run lint:shell` (shellcheck)
- **Workflow changes**: run `bun run lint:actions` (actionlint)
- **New tests**: run the specific test file (`bun test path/to/file.test.ts`) and verify it passes
- **Refactors**: run the full test suite to catch regressions
- **Config changes**: run the relevant command (e.g., `bun install`, `bun run build`)
- **New features**: write a test or run a manual verification script

If you're unsure how to validate a step, that's a sign the step might be too big — break it down further.

### 6. Local validation gate

Before pushing to CI, run the **full local validation suite** to catch issues early. CI round-trips are expensive (10-15 min per cycle) — local validation takes under 2 minutes and prevents wasted iterations.

**Required before every push:**
1. `bun run test` — lint + typecheck + unit tests across all packages
2. `bun run lint:actions` — actionlint on any modified workflow files
3. If infrastructure scripts changed: review with `shellcheck` where feasible

**Only push when local validation is fully green.** If lint or tests fail locally, they will fail in CI — fix them first. The goal is to treat CI as a confirmation step, not a discovery step.

### 7. Documentation

After any structural change (new workflows, new env vars, new architectural patterns, changed CI behavior, new phases completed), **update the relevant docs before committing**:

- **`CLAUDE.md`** — project roadmap, architectural decisions, completed phases, backlog. This is the source of truth for how the project works and what's been done.
- **`docs/ci-pipeline.md`** — CI/CD pipeline reference (workflow diagrams, job details, change detection, design decisions). Update when workflows change.
- **`lessons/`** — per-phase lessons learned, debugging logs, approach tracking. Create/update when working on infra, deployment, or debugging tasks.

Ask yourself: "If someone reads the docs tomorrow, will they understand the current system?" If not, update them.

### 8. Branch, commit & CI

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

# Run only linting (biome + shellcheck)
bun run lint

# Lint shell scripts only
bun run lint:shell

# Lint GitHub Actions workflows (requires actionlint installed)
bun run lint:actions

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

## Completed Phases (1–14, 16, 17F–G, 18A–C, 19, 20A–B, 21, 22, 23A–B, 24)

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
| **18C** | Attribution update — "made with ♥ by alejo · inspired by nemi.fi" across all READMEs and app footer |
| **19** | Dependency updates — 20 non-Aztec packages across 4 risk-based batches |

**Key architectural decisions (from completed phases):**
- CI gate job pattern: workflows always trigger on PRs, `changes` job uses `dorny/paths-filter@v3` for declarative path-based change detection, gate jobs (`SDK/App/Server Status`) always run. `workflow_dispatch` overrides filters to `true`. Full CI reference: `docs/ci-pipeline.md`. Ruleset: `infra/rulesets/main-branch-protection.json`
- AWS OIDC auth (no stored keys), IAM scoped to ECR repo + `Environment` tag. S3 permissions split: `S3AppDeploy` (put/list) and `S3AppCleanup` (delete, object-level ARNs only). Setup: `infra/iam/README.md`
- **Infra files use placeholders** (`<ACCOUNT_ID>`, `<DISTRIBUTION_ID>`, `<OAC_ID>`, `<PROVER_EC2_DNS>`, `<TEE_EC2_DNS>`, etc.) for sensitive AWS resource IDs. **Before using any infra JSON/command**, substitute real values via `sed` or manually. See `infra/iam/README.md` and `infra/cloudfront/README.md` for instructions.
- SSM port forwarding for EC2 access (no public ports). TEE: local:4001→EC2:4000, Prover: local:4002→EC2:80
- SDK e2e structure: `e2e-setup.ts` (preload), `connectivity.test.ts`, `proving.test.ts` (Remote/Local/TEE), `mode-switching.test.ts`, `nextnet.test.ts` (connectivity smoke, auto-skipped on local)
- SDK e2e tests are network-agnostic: always use Sponsored FPC + `from: AztecAddress.ZERO` (no `registerInitialLocalNetworkAccountsInWallet`)
- CI test workflows (`sdk.yml`, `app.yml`, `server.yml`) only trigger on PRs + manual dispatch — no push-to-main triggers (deploy-prod.yml handles post-merge)
- **SDK publish pipeline**: `npm version` doesn't work in Bun workspaces (`workspace:*` protocol error) — use `node -e` to set version. `npm publish --provenance` requires `repository.url` in package.json matching the GitHub repo. YAML `if:` expressions with colons must be double-quoted. `workflow_dispatch` can trigger `_publish-sdk.yml` directly for retries. Uses `NPM_TOKEN` automation token — OIDC trusted publishing only supports one workflow per package (see `lessons/npm-trusted-publishing.md`). npm package-level 2FA must be set to "Authorization only" (not "Authorization and publishing") for automation tokens to work.
- **EC2 deploy**: Use `instance-status-ok` (2/2 checks) instead of `instance-running` for SSM readiness. SSM agent needs the OS fully booted + IAM instance profile with `AmazonSSMManagedInstanceCore`.
- App e2e: Playwright with `mocked` + `fullstack` projects. Mocked tests set `PROVER_URL` via playwright.config env so `PROVER_CONFIGURED=true`. Fullstack tests skip remote/TEE describes when their env vars are not set.
- Env-var-driven feature flags: `PROVER_CONFIGURED = !!process.env.PROVER_URL`, `TEE_CONFIGURED = !!process.env.TEE_URL`. Buttons start `disabled` in HTML; JS enables them when configured + reachable/attested. Service row labels default to "not configured" in HTML.
- **GHA workflow outputs cannot contain secrets**: GitHub masks any output whose value contains a secret string — the output silently becomes empty. Pass non-secret identifiers (e.g. image tags) and reconstruct full URIs in consuming jobs.
- **Multi-stage Dockerfile `ARG`**: `--build-arg` only reaches global-scope `ARG` (before any `FROM`). Must re-declare `ARG` inside each stage that uses it.
- **Docker prune ordering**: `docker image prune -af` deletes images not referenced by running containers. TEE deploy reads images via `nitro-cli` (no container), so prune must follow EIF build. Prover deploy starts a container first, protecting the image.
- **nitro-cli orphaned overlay2 layers**: `nitro-cli build-enclave` creates overlay2 layers that Docker's metadata doesn't track. These layers are invisible to `docker images` and `docker system prune -af` but accumulate ~2-3GB per deploy on disk. Partial cleanup (wiping only overlay2) corrupts Docker's internal state (`failed to register layer`). The correct fix: stop Docker, wipe all of `/var/lib/docker/*`, restart Docker. This is a [known Docker limitation](https://github.com/moby/moby/issues/45939) affecting tools that use `docker export` or similar internal operations. Layer caching is sacrificed but the impact is minimal (~30s extra pull time) since the base image strategy (Phase 20B) keeps the app layer small.
- **CloudFront origin timeout**: `OriginReadTimeout` set to 120s for prover and TEE origins (up from 60s default). 120s is the quota max without an AWS support ticket. For proofs exceeding 120s, request a quota increase to 180s via the Service Quotas console (`Response timeout per origin`). Config: `infra/cloudfront/distribution.json`.
- **TEE socat proxy**: managed via systemd service (`tee-rex-proxy.service`) — `Restart=always`, `RestartSec=3`, `After=nitro-enclaves-allocator.service`, `WantedBy=multi-user.target`. Deploy script writes `ENCLAVE_CID` to `/etc/tee-rex/proxy.env` and installs the unit inline via heredoc. Survives crashes and EC2 reboots. Source-of-truth file: `infra/tee-rex-proxy.service`.
- **Request IDs**: Every server request gets a unique `X-Request-Id` (auto-generated UUID or echoed from client). Returned in response header + error JSON `requestId` field. Logged with `requestId` on prove start/completion and unhandled errors. Middleware runs before `expressLogger()` so all log lines include the ID. Frontend/SDK don't need to send IDs — the server handles it transparently.
- **cbor-x encoding pitfalls** (PR #81): cbor-x has three encoding behaviors that differ from naive expectations: (1) `Uint8Array` → CBOR tagged bstr (tag 64, `0xd840` prefix), but `Buffer` → plain CBOR bstr — COSE_Sign1 Sig_structure requires plain bstr, so always use `Buffer.alloc(0)` not `new Uint8Array(0)` for empty external_aad; (2) 8-byte CBOR uint64 → JavaScript `BigInt`, not `number` — Nitro's Rust NSM library always encodes timestamps as uint64; (3) CBOR maps → plain JS objects with string keys by default, not `Map` instances. Unit tests using JS-generated CBOR won't catch these because JS `number`/`Map`/`Uint8Array` encode differently than Rust/C equivalents.
- **Server uses `PrivateExecutionStepSchema` from `@aztec/stdlib/kernel`** instead of a hand-rolled Zod schema for `/prove` validation. This keeps the schema automatically in sync across Aztec version updates and avoids format mismatches.
- **`sendWithRetry` + `E2E_RETRY_STALE_HEADER`**: On live networks, proving takes 50-90s, during which the block header can go stale ("Block header not found"). `sendWithRetry()` in `aztec.ts` re-simulates to refresh the header and retries up to 3 times. **Gated behind `E2E_RETRY_STALE_HEADER` env var** — only active during Playwright e2e tests (set in `playwright.config.ts` webServer env, forwarded via `vite.config.ts` define block). In production, sends fail immediately — re-simulating silently is unsafe because contract state or user inputs could change between attempts.
- **Rate limit localhost exemption**: `/prove` rate limit (10 req/hour/IP) exempts `127.0.0.1` and `::1` via `skip` callback. SSM tunnels and local dev arrive as localhost; public traffic via CloudFront has `X-Forwarded-For`. Safe because only SSM-credentialed users can reach localhost on EC2.
- **validate-prod scoped to deploy-only tests**: `validate-prod` in `deploy-prod.yml` runs `-g "deploys account"` (3 deploy tests, 1 prove call each) instead of the full 12-test suite. The comprehensive suite runs in `infra.yml` on PRs. `continue-on-error` removed — validate-prod is now a hard gate.

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
| **17G** | SDK auto-publish in `deploy-prod.yml`. `publish-sdk` job triggers on spartan auto-update merges (`chore: update @aztec/*`), reads Aztec version from `@aztec/stdlib` dep, sets SDK version to match, publishes to npm with `--tag spartan` + `--provenance`, creates git tag + GitHub release. Gated by `validate-prod` (full e2e) with `nextnet-check` fallback when validate-prod is skipped. Uses `NPM_TOKEN` automation token (OIDC only supports one workflow per package — doesn't work with deploy-prod + deploy-devnet). `_publish-sdk.yml` also supports `workflow_dispatch` for manual retries. |

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
- Changed footer to `made with ♥ by alejo · inspired by nemi.fi` (with link to github.com/nemi-fi/tee-rex/)

---

## Phase 19: Dependency Updates — DONE (PR #38)

Updated 20 non-Aztec packages across 4 risk-based batches. Skipped `zod` (v4 incompatible with `@aztec/stdlib` Zod 3 schemas).

---

## Phase 20: Deploy Pipeline Optimization

**Goal**: Speed up the deploy-prod pipeline and eliminate disk space fragility on EC2 instances.

**Current state**: Deploy scripts wipe `/var/lib/docker` entirely on every deploy because the EBS volumes are too small to keep cached layers. This forces a full image pull (~2GB) every time and makes deploys slow. EC2 startup now uses `instance-status-ok` (2/2 checks) + 10 min SSM timeout with diagnostics on failure.

**20A — Increase EBS volumes + Docker cleanup:** DONE (PR #45, updated in #74)
- Resized all 4 EC2 EBS volumes from 8GB to 20GB (`aws ec2 modify-volume` + `growpart` / cloud-init auto-grow)
- TEE deploy (`ci-deploy.sh`): uses nuclear Docker wipe (`systemctl stop docker && rm -rf /var/lib/docker/*`) because `nitro-cli build-enclave` creates orphaned overlay2 layers that `docker system prune` cannot remove (see lesson below). Layer caching is not possible for TEE deploys.
- Prover deploy (`ci-deploy-prover.sh`): uses `docker system prune -af` — layer caching works because Docker manages all containers/images normally (no nitro-cli involvement)
- Validated via CI: Remote Prover deploy + e2e (green), TEE deploy + e2e (green)

**20B — Split Docker image into base + app layers:** DONE (PRs #46, #48, #49, #51)
- `Dockerfile.base`: shared base image (Bun + system deps + `bun install` ~2.4GB), tagged `tee-rex:base-<aztec-version>` in ECR
- `Dockerfile` (prover) and `Dockerfile.nitro` stage 2 (builder): `ARG BASE_IMAGE` / `FROM ${BASE_IMAGE}`, removed dep install layers
- `_build-base.yml`: idempotent reusable workflow — reads Aztec version, checks ECR, builds+pushes only if missing. ECR registry cache. Outputs `base_tag` (not full URI — see lessons).
- `_deploy-tee.yml` / `_deploy-prover.yml`: accept `base_tag` input, construct full URI internally from `ECR_REGISTRY` secret + tag, ECR registry cache (bundles Phase 20D)
- `deploy-prod.yml`, `tee.yml`, `remote.yml`: added `ensure-base` job before deploy jobs
- Deploy scripts: `ci-deploy-prover.sh`: stop → pull → run container → prune (container protects image, layer caching works). `ci-deploy.sh`: nuclear Docker wipe → pull → build EIF → prune → run enclave → install systemd proxy (no layer caching due to nitro-cli orphaned overlay2 — see architectural decisions).
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
- Covers all 16 workflow files with mermaid diagrams, change detection paths, conditional deploy logic, Docker image strategy, and key design decisions

---

## Phase 23: Devnet Support — DONE

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

| **23C** | Created `devnet` branch from `main` with devnet Aztec version and `AZTEC_NODE_URL` references. `devnet-backup` branch also exists. |

---

## Phase 24: Stabilize Fullstack E2E & CI Hardening — DONE (PRs #89, #91, #93, #94, #96)

**Goal**: Make `validate-prod` pass reliably (0/50+ runs previously) and harden the deploy pipeline.

| Part | Summary |
|---|---|
| **24A** | `sendWithRetry()` in `aztec.ts` — retries "Block header not found" up to 3 times by re-simulating to refresh stale block headers. Gated behind `E2E_RETRY_STALE_HEADER` env var so production sends fail immediately (re-simulating silently is unsafe). Playwright config sets the flag via webServer env; Vite config forwards it. |
| **24B** | Localhost rate limit exemption — `/prove` rate limiter skips `127.0.0.1`/`::1` (SSM tunnels, local dev). Public traffic still rate-limited via CloudFront's `X-Forwarded-For`. |
| **24C** | Scoped validate-prod — narrowed from full 12-test suite to deploy-only (`-g "deploys account"`), removed `continue-on-error: true`, reduced timeout 60→30 min. Comprehensive tests run in `infra.yml` on PRs. |
| **24D** | `_publish-sdk.yml` gets `workflow_dispatch` — manual SDK publishing from Actions tab without re-running deploy-prod. |
| **24E** | Gate `publish-sdk` on `validate-prod` — `needs: [validate-prod, nextnet-check]` with `always()` + result checks. Blocks on validate-prod failure, falls back to nextnet-check when skipped. |
| **24F** | npm publish fix — switched from OIDC to `NPM_TOKEN` automation token (OIDC only supports one workflow per package). Package-level 2FA set to "Authorization only" to allow automation tokens. |

---

## Phase 25: TEE Stability, Devnet Release & Nightlies Migration

**Goal**: Fix recurring TEE enclave deploy failures, publish a devnet patch release, and migrate from spartan (deprecated) to nightlies dist-tag.

**25A — Fix TEE `nitro-enclaves-allocator` failure:**
- Recurring issue: `nitro-enclaves-allocator.service` fails during TEE deploy (run #22225586998). The EIF builds successfully but the allocator service crashes when restarting.
- Root cause: likely hugepages memory allocation failure after Docker wipe — the allocator can't reclaim memory already mapped by the kernel.
- Fix the deploy script (`infra/ci-deploy.sh`) to handle allocator restart more robustly (stop allocator before Docker wipe, restart after).
- Validate: re-run deploy-prod or trigger `test-tee` on a PR.

**25B — Update READMEs and documentation:**
- Ensure attribution is consistent everywhere: "made with ♥️ by alejo · inspired by nemi.fi"
- Update any stale references in README.md, packages/sdk/README.md, packages/app/index.html

**25C — Devnet patch release (`-patch.1`):**
- Publish a devnet SDK release with `-patch.1` suffix via `workflow_dispatch` on `_publish-sdk.yml` from the `devnet` branch
- Requires devnet infrastructure to be healthy first (depends on 25A fix)

**25D — Migrate from spartan to nightlies:**
- Aztec has deprecated the `spartan` dist-tag in favor of `nightlies`
- Update `aztec-spartan.yml` auto-updater to check `nightlies` instead of `spartan`
- Update `deploy-prod.yml` `publish-sdk` to use `nightlies` dist-tag
- Update `AZTEC_NODE_URL` references if the nextnet endpoint changes
- Update all documentation references from "spartan" to "nightlies"

---

## Backlog

- Phase 6 (next-net testing) absorbed into Phase 12B/12C, further work in Phase 17F
- Phase 11 benchmarking (instance sizing) — tackle when proving speed becomes a bottleneck
- Phase 15 TEE generalization research (TeeProvider interface) — tackle after core features stabilize
- ~~**Gate `publish-sdk` on `validate-prod` instead of `nextnet-check`**~~ ✅ Done (#96) — `publish-sdk` now depends on `[validate-prod, nextnet-check]` with `always()` + result checks. Blocks on validate-prod failure, falls back to nextnet-check when validate-prod is skipped. `_publish-sdk.yml` extracted as reusable workflow with `workflow_dispatch` for manual retries. `continue-on-error` removed from validate-prod — it's now a hard gate.
- ~~**IAM trust policy audit**~~ ✅ Done — tightened `tee-rex-ci-trust-policy.json` from `refs/heads/*` to `refs/heads/main` + `refs/heads/chore/aztec-spartan-*` + `pull_request`. **Note**: apply the updated policy to AWS with `aws iam update-assume-role-policy --role-name tee-rex-ci-github --policy-document file://infra/iam/tee-rex-ci-trust-policy.json`
- ~~**IAM S3 DeleteObject scoping**~~ ✅ Done (#73) — split `S3AppDeploy` into two IAM statements: `S3AppDeploy` (PutObject, ListBucket, GetBucketLocation) and `S3AppCleanup` (DeleteObject on object-level ARNs only). Policy applied to AWS.
- ~~**SDK witness triple-encoding**~~ ✅ Done (#73) — replaced `JSON.parse(jsonStringify(step.witness))` with `Array.from(step.witness.entries())` in `tee-rex-prover.ts`, eliminating a redundant serialization roundtrip for witness data.
- ~~**Socat proxy fragile background process (audit #30)**~~ ✅ Done (#74) — replaced `setsid socat ... & disown` with systemd service (`tee-rex-proxy.service`). Auto-restarts on crash, starts on boot. Also fixed recurring disk space failures: reordered teardown before disk check, nuclear Docker wipe to handle nitro-cli orphaned overlay2 layers.
- ~~**CloudFront origin timeout 60s (audit #2)**~~ ✅ Done (#76) — increased `OriginReadTimeout` from 60s to 120s for both prover and TEE origins. Applied to live distribution. 120s is the quota max without AWS support ticket; request increase to 180s if needed.
- ~~**Request logging and request IDs (audit #21)**~~ ✅ Done (#78) — added `X-Request-Id` middleware to Express server. Auto-generates UUID per request, echoes client-provided IDs. Returned in response headers + error JSON bodies. Structured logging includes `requestId` on prove start/completion and unhandled errors. No frontend changes needed — server generates IDs automatically.

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
6. **Track lessons**: When debugging or deploying, record every approach and its outcome in `lessons/`. Check lessons before trying new approaches. Stop after 3+ failures to reassess.
