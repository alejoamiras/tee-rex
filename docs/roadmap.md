# Tee-Rex Roadmap

History of completed phases, architectural decisions, and backlog.
For phases 1-24 detail, see [roadmap-archive.md](./roadmap-archive.md).

---

## Completed Phases (summary)

| Phase | Summary |
|---|---|
| 1-5 | Monorepo (Bun), e2e tests, LogTape logging, demo frontend, Nitro Enclave attestation |
| 7-10 | Playwright tests, repo rename, CI parallel jobs, Aztec local network in CI |
| 12-14 | Aztec auto-update CI, multi-network support, nextnet, OpenPGP encryption, SDK e2e restructure |
| 16-19 | `PROVER_URL` abstraction, optional remote/TEE modes, granular benchmarks, dependency updates |
| 20-21 | Docker base+app split, EBS resize, multi-region research (sa-east-1, not implemented) |
| 22-24 | CI change detection (dorny), conditional deploys, fullstack e2e stabilization, custom domain (`tee-rex.dev`) |
| 25 | TEE stability fixes, nightlies migration (spartan→nightly), Infra Status gate |
| 26 | OpenTofu IaC migration — 14 HCL files, all AWS resources imported, S3 remote state |
| 27 | Code quality — sort-package-json, split e2e suites (local-network vs smoke), code cleanup |
| 28 | Generalized auto-update (`_aztec-update.yml`), SDK revision versioning (`.1`, `.2` suffixes) |
| 29 | EC2 consolidation — 2 instances → 1 per env, ~46% cost reduction |
| 30 | Wallet SDK integration — `@aztec/wallet-sdk` external wallet support alongside embedded |
| 31 | ~~Local Native Accelerator~~ — moved to standalone repo [`aztec-accelerator`](https://github.com/alejoamiras/aztec-accelerator) |
| 32 | CI/CD — narrow server change detection, smart `/health` version check, `api_version` |
| 33 | Thin Enclave Architecture — host Bun.serve + thin enclave Bun.serve, bb uploaded at runtime |
| 34 | Enclave lockdown — removed direct CloudFront→enclave route, single SSM tunnel via host |
| 35 | Deprecated devnet environment (4→3 envs: mainnet, testnet, nightlies) |
| 36 | Expose proving time in UI step breakdown (`x-prove-duration-ms`) |
| 37 | Remove accelerator package from tee-rex (moved to standalone repo) |

---

## Key Architectural Decisions

- **CI gate pattern**: `dorny/paths-filter` change detection, gate jobs always run. `infra.yml` deploys only when `test-infra` label present. Full reference: `docs/ci-pipeline.md`
- **AWS OIDC auth** (no stored keys), IAM scoped to ECR + `Environment` tag. S3 permissions split: put/list vs delete
- **SSM port forwarding** for EC2 access (no public ports). Host: local:4002→EC2:80
- **SDK e2e**: network-agnostic via Sponsored FPC + `from: AztecAddress.ZERO`. TEE tests `skipIf(!TEE_URL)`
- **SDK publish**: `NPM_TOKEN` automation token (OIDC only supports one workflow per package). Revision versioning via `get-sdk-publish-version.ts`
- **Docker strategy**: `Dockerfile.base` (Bun + deps, tagged by Aztec version) + `Dockerfile` (host) + `Dockerfile.nitro` (enclave). Nuclear Docker wipe before EIF build (nitro-cli orphaned overlay2 layers)
- **CloudFront**: All traffic through host (port 80). Host proxies `/tee/*` and `/prover/*` to enclave internally. `OriginReadTimeout` 120s
- **TEE socat proxy**: systemd service, `Restart=always`, bound to `127.0.0.1` (defense-in-depth)
- **Server zero `@aztec/*` runtime deps**: calls `bb prove` CLI directly. Only deps: `@logtape/logtape`, `openpgp`
- **Custom domain**: Cloudflare DNS + ACM wildcard cert. Subdomains use DNS-only (no proxy). Root redirects via Cloudflare rule
- **Wallet SDK dual-path**: Embedded wallet (in-page PXE) + external wallet (browser extension via `@aztec/wallet-sdk` discovery). `?wallet=embedded` bypasses for e2e
- **Rate limit localhost exemption**: SSM tunnels arrive as localhost, exempt from `/prove` rate limit

---

## Phase 25: TEE Stability & Nightlies Migration — DONE

- **25A**: Fixed hugepages allocation failure (stop allocator before Docker wipe)
- **25B**: README badges and links
- **25D**: Migrated spartan → nightlies dist-tag
- **25E**: Infra Status as 4th required branch protection gate

---

## Phase 26: OpenTofu IaC — DONE

14 HCL files covering all AWS resources. Import-only migration, S3 remote state with DynamoDB locking. Security hardening: SSH disabled, SG split, ECR scan-on-push, S3 encryption, CloudFront TLS 1.2 + HTTP/3. CI: `tofu fmt -check` + `tofu validate` on PR.

---

## Phase 29: EC2 Consolidation — DONE

Single instance per env runs Nitro enclave (localhost:4000 via socat) + host container (port 80, `--network host`). CloudFront routes both `/tee/*` and `/prover/*` through host. Deploy: enclave first, then host. ~46% cost reduction.

---

## Phase 33: Thin Enclave Architecture — DONE

Host (Bun.serve, port 80) manages bb downloads/uploads. Enclave (Bun.serve, port 4000) handles keys, attestation, decryption, proving. bb SHA256 hashes in NSM attestation `user_data`. Docker images no longer bake bb binaries — uploaded at runtime via `POST /upload-bb`.

```
CloudFront → Host (port 80)
               ├─ /health        → aggregates host + enclave
               ├─ /attestation   → proxies to enclave
               ├─ /prove         → downloads bb if needed, uploads, proxies
               └─ /encryption-public-key → proxies
               ▼ (localhost:4000 via socat→vsock)
          Thin Enclave (port 4000)
```

Follow-up: Migrated host from Express to Bun.serve — runtime deps reduced from 9 to 2.

---

## Phase 34: Enclave Lockdown — DONE

Removed CloudFront direct route to port 4000. SG only allows port 80. socat bound to `127.0.0.1`. All CI workflows use single SSM tunnel through host.

---

## Phase 35: Deprecate Devnet — DONE

Removed devnet environment (4→3 envs). Deleted workflows, CloudFront, S3, IAM refs, Tofu resources.

---

## Phase 36: Proving Time in UI — DONE

SDK emits `"proved"` phase with `durationMs`. UI renders "prove" sub-row in step breakdown.

---

## Phase 37: Remove Accelerator Package — DONE

Moved accelerator to standalone repo [`aztec-accelerator`](https://github.com/alejoamiras/aztec-accelerator). Removed `packages/accelerator/`, `ProvingMode.accelerated`, accelerated mode from app, CI workflows (`accelerator.yml`, `release-accelerator.yml`), branch protection gate.

---

## Backlog

- Phase 11: Instance sizing benchmarking — tackle when proving speed becomes a bottleneck
- Phase 15: TEE generalization research (TeeProvider interface) — tackle after core features stabilize
- Phase 21: Multi-region deployment (sa-east-1) — research done, implementation when needed
- Landing page for tee-rex.dev
- Rename `packages/app` → `packages/playground`, domain `playground.tee-rex.dev`
