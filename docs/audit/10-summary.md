# Audit Summary & Prioritized Recommendations

**Date**: 2026-02-16
**Auditor**: Claude Code (Opus 4.6)
**Scope**: Full codebase, CI/CD, infrastructure, security, testing, documentation
**Current state**: Lint 0 issues, TypeScript 0 errors, 70 unit tests passing

---

## Overall Assessment

**Quality tier: B+ (strong foundations, specific gaps to fill for S-tier)**

The codebase is well-architected and shows mature engineering practices: strict TypeScript, structured logging (zero console.log), conventional commits, Biome enforcement, OIDC-based CI auth, and a clean monorepo structure. The attestation cryptography (COSE_Sign1 + certificate chain + AWS Root CA pinning) is correctly implemented. The CI/CD system is sophisticated with reusable workflows, conditional deploys, and auto-update pipelines.

The gaps are concentrated in three areas:
1. **Testing the security-critical path** (attestation verification has no happy-path tests)
2. **Production hardening** (no rate limiting, containers as root, CloudFront timeout too short)
3. **Documentation for humans** (README is minimal, no architecture diagram, no API reference)

---

## Issue Count by Severity

| Severity | Count | Areas |
|----------|-------|-------|
| **Critical** | 3 | App: `waitForTx()` infinite loop, CI: tunnel process leaks, Infra: CloudFront 60s timeout |
| **High** | 12 | Testing gaps, security (auth/rate limiting), IAM, deploy scripts, path filters |
| **Medium** | 25 | Type safety, error handling, DX, consistency, observability |
| **Low** | 20 | Style, cleanup, minor robustness, browser compat |
| **Total** | **60** | |

---

## P0 — Fix Before Presenting (Critical Impact)

These issues could cause visible failures or represent fundamental gaps.

| # | Finding | Source | Effort | Impact |
|---|---------|--------|--------|--------|
| 1 | ~~**`waitForTx()` infinite loop**~~ | App C1 | Trivial | RESOLVED (#67) |
| 2 | **CloudFront origin timeout 60s** — proofs take 1-5 min, users get 504 errors | Infra C1 | Small | Production-breaking |
| 3 | ~~**SSM tunnel processes leaked on CI failure**~~ | CI C1 | Small | RESOLVED (#67) |
| 4 | ~~**Attestation has zero happy-path unit tests**~~ | Testing G1 | Medium | RESOLVED (#71) |
| 5 | ~~**Root README.md is 23 lines**~~ | Docs H1 | Medium | RESOLVED (#71) |

---

## P1 — Fix Soon (High Impact, Reasonable Effort)

| # | Finding | Source | Effort |
|---|---------|--------|--------|
| 6 | ~~`clearIndexedDB()` wipes ALL databases, not just Aztec~~ | App H1 | Trivial | RESOLVED (#67) |
| 7 | ~~50MB JSON body limit on server (DoS vector)~~ | Server H1 | Trivial | RESOLVED (#67) |
| 8 | ~~No rate limiting on `/prove` endpoint~~ | Server H2, Security H1 | Small | RESOLVED (#69) |
| 9 | `publish-sdk` gated by smoke test, not full validation | CI H1 | Medium | |
| 10 | ~~Path filters don't include workflow file changes~~ | CI H2 | Trivial | RESOLVED (#67) |
| 11 | ~~Required secrets not validated before use in deploys~~ | CI H3 | Small | RESOLVED (#67) |
| 12 | ~~All containers run as root~~ | Infra H1, Security M1 | Medium | RESOLVED (#67) |
| 13 | IAM `s3:DeleteObject` unrestricted on prod bucket | Infra H2, Security M4 | Medium | |
| 14 | ~~Deploy scripts don't check disk space~~ | Infra H3 | Trivial | RESOLVED (#67) |
| 15 | ~~No architecture diagram anywhere~~ | Docs H2 | Small | RESOLVED (#70) |
| 16 | ~~`extractSimDetail()` uses `any` without validation~~ | App H2 | Small | RESOLVED (#69) |
| 17 | ~~Accessibility: no ARIA labels, color-only indicators~~ | App H3 | Medium | RESOLVED (#69) |

---

## P2 — Improve When Time Allows (Medium Impact)

| # | Finding | Source | Effort |
|---|---------|--------|--------|
| 18 | ~~Server returns generic 500 for all errors (no 400 for validation)~~ | Server M1 | Small | RESOLVED (#69) |
| 19 | ~~TEE_MODE env var cast without runtime validation~~ | Server M2 | Trivial | RESOLVED (#67) |
| 20 | ~~Base64 input not validated before decoding~~ | Server M3 | Trivial | RESOLVED (#67) |
| 21 | No request logging or request IDs | Server M4 | Small |
| 22 | Witness serialization triple-encodes large data | SDK H2 | Medium |
| 23 | ~~Unsafe type casts in attestation.ts CBOR decoding~~ | SDK M1 | Small | RESOLVED (#70) |
| 24 | ~~No retry logic for remote proving~~ | SDK M2 | Small | RESOLVED (#71) |
| 25 | ~~Attestation nonce not validated by SDK~~ | SDK M5, Security H2 | Medium | RESOLVED (#70) |
| 26 | ~~Mutable global state in app (document or refactor)~~ | Quality M1 | Trivial | RESOLVED (#70) |
| 27 | ~~Vite `loadEnv` loads all env vars (no VITE_ prefix)~~ | App M3, Security M2 | Small | RESOLVED (#69) |
| 28 | ~~`innerHTML` usage in main.ts~~ | App M7, Security H3 | Small | RESOLVED (#67) |
| 29 | ~~Health check timeout asymmetry in CI~~ | CI M1 | Trivial | RESOLVED (#69) |
| 30 | socat proxy is a fragile background process | Infra M1 | Small |
| 31 | No monitoring or alerting on EC2 | Infra M4 | Medium |
| 32 | ~~CLAUDE.md is the primary docs but not discoverable~~ | Docs M1 | Small | RESOLVED (#71) |
| 33 | ~~No contribution guide (CONTRIBUTING.md)~~ | Docs M3 | Small | RESOLVED (#71) |
| 34 | ~~Server error handling not tested~~ | Testing G2 | Small | RESOLVED (#69) |
| 35 | No failure-injection e2e tests | Testing G3 | Medium |
| 36 | ~~NSM library cloned without integrity check~~ | Infra M3, Security M3 | Trivial | RESOLVED (#67) |

---

## Quick Wins (Trivial Effort, Meaningful Impact)

These can be done in a single focused session:

1. ~~Add timeout to `waitForTx()` (App C1)~~ — RESOLVED (#67)
2. ~~Reduce server JSON limit from 50MB to 10MB (Server H1)~~ — RESOLVED (#67)
3. ~~Filter `clearIndexedDB()` to Aztec prefixes only (App H1)~~ — RESOLVED (#67)
4. ~~Add `trap 'kill $PID' EXIT` to SSM tunnel scripts (CI C1)~~ — RESOLVED (#67)
5. ~~Validate required secrets at deploy job start (CI H3)~~ — RESOLVED (#67)
6. ~~Add `.github/workflows/*.yml` to deploy-prod.yml path filters (CI H2)~~ — RESOLVED (#67)
7. ~~Add disk space check to deploy scripts (Infra H3)~~ — RESOLVED (#67)
8. ~~Validate TEE_MODE with Zod (Server M2)~~ — RESOLVED (#67)
9. ~~Add Zod schema for `/prove` request body (Server M3)~~ — RESOLVED (#67)
10. ~~Add `retention-days: 7` to artifact uploads (CI L3)~~ — RESOLVED (#69)

---

## Strengths to Highlight in Presentation

These are genuinely strong engineering decisions worth calling out:

1. **Attestation chain**: COSE_Sign1 → SHA384 → certificate chain → AWS Nitro Root CA. Correctly implemented, with dynamic imports for browser compatibility.

2. **CI/CD sophistication**: Reusable workflows, dorny/paths-filter change detection, conditional deploys saving 50+ min on app-only changes, auto-update pipeline (detect → PR → test → merge → deploy → publish).

3. **Zero console.log**: Structured LogTape logging across all packages. Library-first SDK pattern.

4. **OIDC everywhere**: No stored AWS credentials. Trust policy scoped to specific branches.

5. **Docker layer caching**: Base image in ECR, idempotent builds, registry cache. Deploys pull only changed layers.

6. **E2E across all proving modes**: Local WASM, remote server, TEE with attestation. Mode-switching tests. Network-agnostic (local sandbox + nextnet).

7. **Encryption**: curve25519 + AES-256-GCM (SEIPDv2) — modern, authenticated, correctly configured.

8. **Conventional commits + commitlint + lint-staged**: Consistent commit history, enforced at pre-commit.

9. **Lessons-driven development**: `lessons/` folder captures debugging sessions. CLAUDE.md records every architectural decision with rationale.

10. **Multi-environment**: prod (spartan/nextnet) + devnet, with separate deploy pipelines, IAM scoping, and SDK dist-tags.

---

## Recommended Fix Order

For maximum impact in a focused sprint:

**Day 1 (Quick Wins)**:
- Items 1-10 from Quick Wins list (all trivial)
- Expand README.md with architecture diagram and quick start
- Result: All criticals fixed, first impression dramatically improved

**Day 2-3 (P1 Hardening)**:
- Add rate limiting to server
- Add non-root user to Dockerfiles
- Scope IAM s3:DeleteObject
- Request CloudFront timeout increase from AWS
- Fix publish-sdk gate logic

**Day 4-5 (Testing)**:
- Add attestation happy-path unit tests (the single highest-impact test improvement)
- Add server error handling tests
- Add one failure-injection e2e test

**Week 2 (P2 Polish)**:
- SDK API reference in README
- CONTRIBUTING.md
- Replace innerHTML with textContent
- Add request IDs and structured error responses
- Address remaining P2 items as time allows

---

## Files Created by This Audit

```
docs/audit/
├── 00-master-plan.md      — Audit strategy, scope, progress tracker
├── 01-sdk.md              — SDK package: 0 critical, 2 high, 5 medium, 4 low
├── 02-server.md           — Server package: 0 critical, 2 high, 6 medium, 4 low
├── 03-app.md              — App package: 1 critical, 3 high, 7 medium, 5 low
├── 04-ci-cd.md            — CI/CD workflows: 1 critical, 3 high, 5 medium, 4 low
├── 05-infra-docker.md     — Infrastructure & Docker: 1 critical, 3 high, 6 medium, 2 low
├── 06-security.md         — Security cross-cutting: 0 critical, 3 high, 4 medium, 3 low
├── 07-testing.md          — Testing gaps: 1 critical, 3 high, 4 medium, 3 low
├── 08-docs-dx.md          — Documentation & DX: 0 critical, 3 high, 5 medium, 3 low
├── 09-code-quality.md     — Code quality: 0 critical, 0 high, 3 medium, 7 low
└── 10-summary.md          — This file: prioritized recommendations
```
