# Tee-Rex Roadmap Archive

> Archived from roadmap.md — phases 1-24 completed before 2026.

---

## Completed Phases Summary (1–24.5)

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
| **12** | Aztec auto-update CI — nightlies version detection → PR → full test suite (incl. TEE) → auto-merge. Gate job pattern, reusable workflows, composite actions. `PAT_TOKEN` for PR-triggered workflows. Branch protection: 4 gate jobs (SDK, App, Server, Infra Status). (Originally spartan, migrated to nightlies in Phase 25D.) |
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

---

## Phase 17: Auto-Deploy Pipeline

**Goal**: After the aztec-nightlies auto-update PR passes all tests (including deployed prover + TEE), auto-merge and deploy everything to production. Nightly auto-updates keep the live system current with zero manual intervention.

**Decision**: No custom domain. Use **CloudFront** as the single entry point — serves the static app from S3 and proxies to EC2 backends. One `https://d1234abcd.cloudfront.net` URL, same-origin, no CORS, no mixed content, no domain needed.

**Architecture:**

```
aztec-nightlies.yml detects new version
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
  Server  App   SDK
  EC2     S3    npm
  (enclave + prover)

    CloudFront (https://nextnet.tee-rex.dev)
      ├── /*           → S3 bucket (static Vite build)
      ├── /prover/*    → EC2 host (http, port 80)
      └── /tee/*       → EC2 host (http, port 80)  ← host proxies to enclave
```

**Completed parts:**

| Part | Summary |
|---|---|
| **17A** | Fixed non-TEE `Dockerfile` (missing `packages/app/package.json` COPY, added healthcheck + curl) |
| **17B** | `remote.yml` + `_deploy-prover.yml` — CI prover deploy on `test-remote` label. `infra/ci-deploy-prover.sh`. CI EC2: `t3.xlarge` |
| **17C** | Nightlies workflow adds `test-infra` label to auto PRs (combined TEE + Remote deploy + e2e via `infra.yml`). Individual `tee.yml` / `remote.yml` kept for isolated debugging via `test-tee` / `test-remote` labels. |
| **17D** | `deploy-prod.yml` (push to main → deploy to prod). Originally separate TEE + prover EC2s, now consolidated to single EC2 per env (Phase 29). IAM: `Environment: ["ci", "prod"]`. Prod EC2: `m5.xlarge` with Elastic IP. Secrets: `PROD_TEE_INSTANCE_ID` |
| **17E** | CloudFront + S3 for production app. S3 bucket `tee-rex-app-prod` (OAC, private). CloudFront distribution `<DISTRIBUTION_ID>` with 3 origins: S3 (default), prover EC2 (`/prover/*`), TEE EC2 (`/tee/*`). CF Function strips path prefixes. COOP/COEP response headers policy. `deploy-prod.yml` has `deploy-app` job (build + S3 sync + CF invalidation). SG rule: CloudFront prefix list for ports 80-4000. IAM: S3 + CF invalidation permissions. Secrets: `PROD_S3_BUCKET`, `PROD_CLOUDFRONT_DISTRIBUTION_ID`, `PROD_CLOUDFRONT_URL`. Setup docs: `infra/cloudfront/README.md`. |
| **17F** | Nextnet connectivity smoke test (`nextnet.test.ts`) + `nextnet-check` job in `deploy-prod.yml` as pre-publish gate. `validate-prod` job runs app fullstack e2e against nextnet after all deploys complete (SSM tunnels to prod TEE + prover). |
| **17G** | SDK auto-publish in `deploy-prod.yml`. `publish-sdk` job triggers on nightlies auto-update merges (`chore: update @aztec/*`), reads Aztec version from `@aztec/stdlib` dep, sets SDK version to match, publishes to npm with `--tag nightlies` + `--provenance`, creates git tag + GitHub release. Gated by `validate-prod` (full e2e) with `nextnet-check` fallback when validate-prod is skipped. Uses `NPM_TOKEN` automation token (OIDC only supports one workflow per package — doesn't work with deploy-prod + deploy-devnet). `_publish-sdk.yml` also supports `workflow_dispatch` for manual retries. |

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
- `ensure-base`, `deploy-server` gated on `servers == 'true'`
- `deploy-app` gated on `app == 'true'`
- `validate-prod` runs when either changed (`!cancelled()` + OR condition)
- `nextnet-check` and `publish-sdk` remain ungated (independent of what changed)
- App-only merges now skip ~50 min of server deploys; workflow-only merges skip all deploys

**22C — CI pipeline documentation:** DONE (PR #61)
- Moved `lessons/ci-pipeline-audit.md` to `docs/ci-pipeline.md` as a living reference
- Covers all 16 workflow files with mermaid diagrams, change detection paths, conditional deploy logic, Docker image strategy, and key design decisions

---

## Phase 23: Devnet Support — DONE

**Goal**: Support a separate `devnet` deployment alongside production (`nextnet`/`nightlies`). Long-lived `devnet` branch, own infrastructure. Auto-update via `aztec-devnet.yml` (weekly, Phase 28A+C), push-triggered deploy.

**Architecture:**

```
main branch (nightlies/nextnet) → deploy-prod.yml (on push)     → prod EC2s + S3 + CF
devnet branch (devnet Aztec)  → deploy-devnet.yml (on push)   → devnet EC2s + S3 + CF

deploy-devnet.yml flow:
  push to devnet (or workflow_dispatch)
    → ensure-base
    → deploy-server (enclave + prover on single EC2)
    → validate-devnet (SDK + app e2e against deployed infra)  ← quality gate
    → deploy-app (devnet S3/CF)
    → publish-sdk (npm --tag devnet)  ← only if validate green
```

No branch protection ruleset on `devnet` — the workflow itself is the quality gate. E2e must pass before app deploys and SDK publishes.

**Completed parts:**

| Part | Summary |
|---|---|
| **23A** | IAM templates updated: `refs/heads/devnet` in trust policy, `devnet` in Environment tags / S3 / CloudFront. `_deploy-tee.yml` / `_deploy-prover.yml` extended with devnet instance ID resolution. AWS provisioning (EC2, S3, CF, secrets) done via CLI after merge. |
| **23B** | `deploy-devnet.yml`: `workflow_dispatch`-only pipeline. Jobs: `ensure-base` → `deploy-tee` + `deploy-prover` → `validate-devnet` (blocking SSM tunnels + SDK e2e + app fullstack e2e) → `deploy-app` + `publish-sdk`. Extracted `_publish-sdk.yml` reusable workflow (parameterized `dist_tag` + `latest`) — `deploy-prod.yml` refactored to call it with `nightlies`/`true`, devnet calls with `devnet`/`false`. Git tag `|| true` handles same-version edge case. |

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

## Phase 24.5: Custom Domain (`tee-rex.dev`) — DONE (PR #98)

**Goal**: Set up `nextnet.tee-rex.dev` and `devnet.tee-rex.dev` as custom domains, add environment indicator + switcher in the frontend.

| Part | Summary |
|---|---|
| **Infra** | ACM wildcard cert (`*.tee-rex.dev`) in us-east-1. CloudFront alternate domain names on both distributions. Cloudflare CNAME records (DNS-only / gray cloud). Root domain `tee-rex.dev` 301-redirects to `nextnet.tee-rex.dev` via Cloudflare Redirect Rule (dummy A record `192.0.2.1` proxied). GitHub secrets updated: `PROD_CLOUDFRONT_URL` → `https://nextnet.tee-rex.dev`, `DEVNET_CLOUDFRONT_URL` → `https://devnet.tee-rex.dev`. Runbook: `infra/cloudfront/custom-domain-setup.md`. |
| **Frontend** | `VITE_ENV_NAME` env var (`"nextnet"` or `"devnet"`) baked at build time. Environment badge in header (emerald for nextnet, amber for devnet) with cross-environment switcher link. Hidden in local dev (no env var). `ENV_NAME`, `OTHER_ENV_URL`, `OTHER_ENV_NAME` exports in `aztec.ts`. |
| **CI** | `VITE_ENV_NAME: nextnet` in `deploy-prod.yml`, `VITE_ENV_NAME: devnet` in `deploy-devnet.yml`. |

**Key decisions:**
- Subdomain CNAMEs MUST use `proxied: false` (gray cloud). Cloudflare orange-cloud proxy rewrites `Host` header → CloudFront rejects.
- Root redirect uses `proxied: true` because Cloudflare Redirect Rules only work on proxied traffic.
- `.dev` TLD is HSTS-preloaded — browsers enforce HTTPS-only, no HTTP downgrade attacks possible.
- Old CloudFront URLs (`*.cloudfront.net`) still work — backward compatible.
