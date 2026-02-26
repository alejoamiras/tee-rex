# Tee-Rex Roadmap

Full history of completed phases, architectural decisions, and backlog items.
**Read this file** when working on infrastructure, deployment, CI, or any task that references a past phase.

---

## Completed Phases (1–14, 16, 17F–G, 18A–C, 19, 20A–B, 21, 22, 23A–B, 24, 24.5, 25, 26, 27, 28A+C)

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

## Key Architectural Decisions

- CI gate job pattern: workflows always trigger on PRs, `changes` job uses `dorny/paths-filter@v3` for declarative path-based change detection, gate jobs (`SDK/App/Server/Infra Status`) always run. `infra.yml` triggers on all PRs but only deploys when `test-infra` label is present — Infra Status auto-passes otherwise. `workflow_dispatch` overrides filters to `true`. Full CI reference: `docs/ci-pipeline.md`. Ruleset: `infra/rulesets/main-branch-protection.json`
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
- **Custom domain (`tee-rex.dev`)**: Cloudflare DNS + ACM wildcard cert + CloudFront alternate domain names. `nextnet.tee-rex.dev` (prod) and `devnet.tee-rex.dev` (devnet). Subdomain CNAMEs use DNS-only mode (`proxied: false`) — Cloudflare proxy rewrites `Host` header, breaking CloudFront. Root domain redirects via Cloudflare Redirect Rule (requires `proxied: true` A record). `VITE_ENV_NAME` env var controls frontend badge/switcher. Runbook: `infra/cloudfront/custom-domain-setup.md`.
- **`sendWithRetry` + `E2E_RETRY_STALE_HEADER`**: On live networks, proving takes 50-90s, during which the block header can go stale ("Block header not found"). `sendWithRetry()` in `aztec.ts` re-simulates to refresh the header and retries up to 3 times. **Gated behind `E2E_RETRY_STALE_HEADER` env var** — only active during Playwright e2e tests (set in `playwright.config.ts` webServer env, forwarded via `vite.config.ts` define block). In production, sends fail immediately — re-simulating silently is unsafe because contract state or user inputs could change between attempts.
- **Rate limit localhost exemption**: `/prove` rate limit (10 req/hour/IP) exempts `127.0.0.1` and `::1` via `skip` callback. SSM tunnels and local dev arrive as localhost; public traffic via CloudFront has `X-Forwarded-For`. Safe because only SSM-credentialed users can reach localhost on EC2.
- **validate-prod scoped to deploy-only tests**: `validate-prod` in `deploy-prod.yml` runs `-g "deploys account"` (3 deploy tests, 1 prove call each) instead of the full 12-test suite. The comprehensive suite runs in `infra.yml` on PRs. `continue-on-error` removed — validate-prod is now a hard gate.

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
| **17C** | Nightlies workflow adds `test-infra` label to auto PRs (combined TEE + Remote deploy + e2e via `infra.yml`). Individual `tee.yml` / `remote.yml` kept for isolated debugging via `test-tee` / `test-remote` labels. |
| **17D** | `deploy-prod.yml` (push to main → deploy TEE + prover to prod). `_deploy-tee.yml` / `_deploy-prover.yml` parameterized with `environment` + `image_tag` inputs. IAM: `Environment: ["ci", "prod"]`. Prod EC2: TEE `m5.xlarge` + prover `t3.xlarge` with Elastic IPs. Secrets: `PROD_TEE_INSTANCE_ID`, `PROD_PROVER_INSTANCE_ID` |
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

**Goal**: Support a separate `devnet` deployment alongside production (`nextnet`/`nightlies`). Long-lived `devnet` branch, `workflow_dispatch`-triggered deploy, own infrastructure. No auto-update — Aztec devnet versions are managed manually (cherry-pick from main or direct commits to `devnet` branch).

**Architecture:**

```
main branch (nightlies/nextnet) → deploy-prod.yml (on push)     → prod EC2s + S3 + CF
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

---

## Phase 25: TEE Stability, Devnet Release & Nightlies Migration

**Goal**: Fix recurring TEE enclave deploy failures, publish a devnet patch release, and migrate from spartan (deprecated) to nightlies dist-tag. Version format: `X.Y.Z-spartan.YYYYMMDD` → `X.Y.Z-nightly.YYYYMMDD`.

**25A — Fix TEE `nitro-enclaves-allocator` failure:** DONE (PR #100)
- Root cause: hugepages memory allocation failure after Docker wipe — allocator couldn't reclaim memory already mapped by the kernel.
- Fix: stop allocator before Docker wipe, restart after. Proper cleanup ordering in `infra/ci-deploy.sh`.

**25B — Update READMEs and documentation:** DONE (PR #99)
- CI badges (SDK, App, Server, Deploy Production) and live site links added to root README
- SDK workflow badge added to `packages/sdk/README.md`
- App footer: linked "alejo" to GitHub repo

**25C — Devnet patch release (`-patch.1`):** DONE
- Reset `devnet` branch to `main`, updated Aztec deps to `4.0.0-devnet.2-patch.1`, deployed via `deploy-devnet.yml`
- Published SDK `@alejoamiras/tee-rex@4.0.0-devnet.2-patch.1` with `--tag devnet`
- Previous devnet branch backed up at `devnet-backup`

**25D — Migrate from spartan to nightlies:** DONE (PR #101)
- Renamed `aztec-spartan.yml` → `aztec-nightlies.yml`, `check-aztec-spartan.ts` → `check-aztec-nightlies.ts`
- Updated `VERSION_PATTERN` to accept `nightly` only (rejects spartan); `AZTEC_VERSION_PATTERN` still accepts both for cross-format upgrades
- `deploy-prod.yml` `publish-sdk` now uses `dist_tag: nightlies`; `_publish-sdk.yml` default changed to `nightlies`
- IAM trust policy: `chore/aztec-spartan-*` → `chore/aztec-nightlies-*` (applied to AWS)
- All docs updated: `CLAUDE.md`, `docs/ci-pipeline.md`, `packages/sdk/README.md`, `infra/iam/README.md`
- `AZTEC_NODE_URL` unchanged (`https://nextnet.aztec-labs.com`)

**25E — Infra Status branch protection gate:** DONE (PR #103)
- `infra.yml` now triggers on all PRs (not just `test-infra` label). When label absent, all jobs skip and Infra Status auto-passes. When present, runs full deploy + e2e and blocks merge on failure.
- Added **Infra Status** as 4th required check in branch protection (alongside SDK/App/Server Status).
- Prevents auto-merge from racing ahead of infrastructure tests (which caused PR #102 e2e failures).

---

## Phase 26: OpenTofu Infrastructure-as-Code Migration — DONE (PRs #111, #112, #113, #117, #118)

**Goal**: Codify all existing AWS infrastructure (6 EC2 instances, 2 CloudFront distributions, S3 buckets, ECR, IAM, security groups, EIPs, ACM) as OpenTofu configuration. Import-only — no resources recreated.

**Strategy**: Single state file for all 3 environments (ci, prod, devnet). S3 remote state with DynamoDB locking. Local-only execution (no CI integration). CI runs `tofu fmt -check` + `tofu validate` on every PR that touches `.tf` files.

**Key decisions:**
- **Import-only migration**: All resources imported via `tofu import` CLI commands — IDs never appear in committed files.
- **Security for public repo**: `terraform.tfvars` (gitignored) holds all real values. `.tf` files use `var.*` and `data.*` only. `terraform.tfvars.example` committed with placeholder values.
- **Safety guardrails**: `lifecycle { prevent_destroy }` on S3, CloudFront, ACM, key pair. `lifecycle { ignore_changes = [ami, user_data] }` on all EC2 instances to prevent replacements.
- **Safety snapshot**: `snapshot.sh` captures complete AWS state to `.snapshot/` (gitignored) before any imports — "break glass" recovery document.
- **Replaced `infra/opentofu-example/`**: Deleted the Phase 21 research artifact, replaced with production OpenTofu configuration.
- **No `tofu plan` in CI**: fmt + validate catches 90% of issues with zero AWS credentials. Plan/apply remain local-only — appropriate for a solo/small-team project. Revisit when multiple contributors touch infra.

| Part | Summary |
|---|---|
| **26A** | OpenTofu migration — 14 HCL files covering all AWS resources. S3 remote state with DynamoDB locking. All resources imported via `tofu import`, `tofu plan` shows zero diff. (PR #111) |
| **26B** | Security hardening — 13 findings (3 critical, 10 recommended). SSH disabled by default, SG port range split, redundant IAM policy removed, ECR scan-on-push, S3 encryption + versioning, CloudFront TLS 1.2 + HTTP/3 + security headers (HSTS, X-Content-Type-Options, X-Frame-Options), OIDC trust `pull_request` condition removed. All applied live via `tofu apply` — zero downtime. (PR #112) |
| **26D** | Post-merge fixes for 26B. (1) Added `ecr:DescribeImages` to both managed and inline CI IAM policies — missing permission caused `_build-base.yml` ECR check to fail silently (stderr redirected to `/dev/null`), making every Build Base Image job rebuild unnecessarily. (2) Reverted ECR from `IMMUTABLE` to `MUTABLE` tags — immutable tags are incompatible with static deploy tags (`prod-prover`, `prod-tee`) that get overwritten on each deploy. (3) Tofu state cleanup: `tofu state mv` for renamed inline policy, created missing managed policy + attachment, removed stale data source. Final `tofu plan` shows zero diff. (PRs #117, #118) |
| **26C** | CI lint — `tofu fmt -check -diff` + `tofu init -backend=false` + `tofu validate` job in `actionlint.yml` with change detection for `infra/tofu/**/*.tf`. `lint:tofu` standalone script (mirrors `lint:actions` pattern — not in main `lint` chain). `tofu fmt` lint-staged hook auto-formats `.tf` files on commit. (PR #113) |

**Files:**
- `infra/tofu/*.tf` — 14 HCL files (backend, providers, versions, variables, data, iam, security-group, ec2, eip, ecr, s3, acm, cloudfront, outputs)
- `infra/tofu/terraform.tfvars.example` — placeholder values (committed)
- `infra/tofu/snapshot.sh` — AWS state capture script
- `infra/tofu/README.md` — usage guide with import commands and safety notes

---

## Phase 27: Code Quality & Showcase Readiness — DONE (PRs #106, #107, #109, #110, #114)

**Goal**: Polish the codebase for showcase readiness — enforce consistent formatting, improve test pipeline speed, clean up code, and make the live app more presentable.

| Part | Summary |
|---|---|
| **27A** | `sort-package-json` added to quality pipeline — enforces canonical key ordering in all `package.json` files. Runs as auto-fix in lint-staged and as check-only gate in `bun run lint`. (PR #106) |
| **27B** | Slim `CLAUDE.md` + add GitHub icon link to app header bar. (PR #107) |
| **27C** | Code quality cleanup — extract `executeStep()` helper in `aztec.ts` (deduplicates simulate→send→confirm pattern, -58 lines), consolidate magic constants, add `$btn()` typed helper in `ui.ts` (eliminates 8 casts), add CORS comment in server. (PR #109) |
| **27D** | Split app e2e into fast + slow suites. `demo.fullstack.spec.ts` → `demo.local-network.spec.ts` (12 tests, simulated proofs, ~5 min) + `demo.smoke.spec.ts` (3 deploy-only tests, real proofs). Shared helpers extracted to `fullstack.helpers.ts`. Per-PR pipeline (`app.yml`) now runs local-network tests instead of real-proof fullstack (~5 min vs 30-60 min). (PR #110) |
| **27E** | App links cleanup — visible "GitHub" text label in header, replace raw CloudFront URLs (`d3d1wk4leq65j7.cloudfront.net`) with custom domain (`nextnet.tee-rex.dev`) in dev scripts. (PR #114) |

---

## Phase 28: Auto-Update & SDK Versioning for All Environments

**Goal**: Extend the nightly auto-update pipeline to devnet (and eventually testnet/mainnet), and solve SDK re-publishing when the Aztec version hasn't changed but SDK code has.

**28A+C — Generalized auto-update pipeline:** DONE
- Extracted `_aztec-update.yml` reusable workflow — parameterized check→update→PR flow (inputs: `dist_tag`, `target_branch`, `branch_prefix`, `add_label`, `auto_merge`, `version`)
- `aztec-nightlies.yml` → thin wrapper calling `_aztec-update.yml` with `nightly`/`main` params
- New `aztec-devnet.yml` — thin wrapper for devnet (weekly Monday 09:00 UTC, targets `devnet` branch, immediate merge)
- Generalized `check-aztec-nightlies.ts` → `check-aztec-update.ts` — takes dist-tag as positional arg
- Broadened `update-aztec-version.ts` — `VERSION_PATTERN` and `AZTEC_VERSION_PATTERN` now accept `devnet.N[-patch.N]` formats
- Added push trigger to `deploy-devnet.yml` (on push to `devnet` branch, paths-ignore for docs/tests)
- IAM trust policy: added `chore/aztec-devnet-*` branch pattern

**28B — SDK revision versioning:**
- Problem: npm won't let you re-publish the same version. If the Aztec devnet version is `4.0.0-devnet.2-patch.1` and we need to publish an SDK-only fix, we need a revision suffix.
- Solution: append a dot-separated SDK revision number:
  ```
  4.0.0-devnet.2-patch.1      ← first publish (matches Aztec version)
  4.0.0-devnet.2-patch.1.1    ← SDK-only fix (revision 1)
  4.0.0-devnet.2-patch.1.2    ← another fix (revision 2)
  ```
- Valid semver, sorts correctly (more prerelease identifiers = higher precedence per spec 11.4.4)
- Resets to no suffix when a new Aztec version drops
- Applies to both devnet and nightlies (`5.0.0-nightly.20260224.1`)
- Implementation: `_publish-sdk.yml` checks npm for existing versions with the same Aztec prefix, finds highest revision suffix, increments. If none exists, publishes without suffix.

---

## Backlog

- Phase 6 (next-net testing) absorbed into Phase 12B/12C, further work in Phase 17F
- Phase 11 benchmarking (instance sizing) — tackle when proving speed becomes a bottleneck
- Phase 15 TEE generalization research (TeeProvider interface) — tackle after core features stabilize
- ~~**Gate `publish-sdk` on `validate-prod` instead of `nextnet-check`**~~ Done (#96)
- ~~**IAM trust policy audit**~~ Done
- ~~**IAM S3 DeleteObject scoping**~~ Done (#73)
- ~~**SDK witness triple-encoding**~~ Done (#73)
- ~~**Socat proxy fragile background process (audit #30)**~~ Done (#74)
- ~~**CloudFront origin timeout 60s (audit #2)**~~ Done (#76)
- ~~**Request logging and request IDs (audit #21)**~~ Done (#78)
