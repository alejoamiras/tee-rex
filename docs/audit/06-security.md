# Security Audit (Cross-Cutting)

**Date**: 2026-02-16  
**Status**: Complete  
**Scope**: Authentication, encryption, input validation, supply chain, CI secrets  

## Summary

The security posture is strong for the project's stage: proper COSE_Sign1 attestation, OpenPGP encryption (curve25519 + AES-256-GCM), OIDC auth for CI, and no stored credentials. The primary security model relies on encryption (not authentication) — the server has no auth layer, and defense comes from payload encryption + VPC isolation. Key gaps: no rate limiting, no nonce validation in attestation, containers run as root, and `innerHTML` usage in the frontend.

## Threat Model

```
Client (browser) ──HTTPS──> CloudFront ──HTTP──> EC2 (prover/TEE)
                                         │
                                         └──> S3 (static app)

Security layers:
1. CloudFront: HTTPS termination, COOP/COEP headers
2. VPC: EC2 only reachable from CloudFront prefix list
3. Encryption: Execution steps encrypted with server's PGP public key
4. Attestation: Client verifies COSE_Sign1 from Nitro Enclave
5. No authentication: Server is stateless, proof results are public
```

## Findings

### High

#### H1. No authentication or rate limiting on server
- **Files**: `packages/server/src/index.ts` (entire file)
- **Issue**: Server has no auth (API keys, JWTs, mTLS). `/prove` is computationally expensive (minutes of CPU). Combined with 50MB body limit, the server is vulnerable to resource exhaustion.
- **Current mitigation**: VPC security group limits access to CloudFront prefix list. CloudFront rate limiting not configured.
- **Impact**: Anyone who can reach CloudFront can submit expensive proving requests.
- **Category**: Availability
- **Fix**: Add CloudFront WAF with rate limiting (e.g., 10 requests/minute per IP). Or add API key header validation in the Express app.
- **Effort**: Medium

#### H2. Attestation nonce not validated by SDK
- **File**: `packages/sdk/src/lib/attestation.ts:182`
- **Issue**: `nonce` field is parsed from the attestation document but never checked. The `AttestationVerifyOptions` has no `expectedNonce` parameter. This means the same attestation document could be replayed.
- **Impact**: An attacker could capture a valid attestation and replay it to trick the SDK into encrypting data for a different server.
- **Practical risk**: Low — attestation has a 5-minute freshness check (maxAgeMs), and the public key is embedded in the attestation, so replayed docs would use the same key.
- **Category**: Protocol Security
- **Fix**: Add `expectedNonce?: string` to `AttestationVerifyOptions`. Document in README that callers should generate a random nonce, pass it when requesting attestation, and verify it matches.
- **Effort**: Medium (requires server-side changes too)

#### H3. `innerHTML` usage with template literals — RESOLVED (#67)
- **File**: `packages/app/src/main.ts` (step rendering)
- **Issue**: Step names are inserted into DOM via `innerHTML`. While step names come from code (not user input), this pattern is fragile — if data sources change, XSS becomes possible.
- **Category**: Web Security
- **Fix**: Replace all `innerHTML` with `textContent` + explicit element creation.
- **Effort**: Small
- **Resolution**: Replaced all innerHTML with `buildDotRow()` helper + `replaceChildren()`. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

### Medium

#### M1. Containers run as root — RESOLVED (#67)
- **Files**: `Dockerfile`, `Dockerfile.base`, `Dockerfile.nitro`
- **Issue**: All services run as root. Container breakout + EC2 metadata service = potential privilege escalation.
- **Category**: Defense in Depth
- **Fix**: Add non-root USER to Dockerfiles (see infra audit for details).
- **Effort**: Medium
- **Resolution**: Added non-root `appuser` to prover and Nitro Dockerfiles. Nitro drops privileges via `su` after root-only network setup. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### M2. Vite loads all env vars (not just VITE_)
- **File**: `packages/app/vite.config.ts:77`
- **Issue**: `loadEnv(mode, process.cwd(), "")` loads all environment variables. Sensitive vars could leak into the browser bundle via `process.env.*` replacements.
- **Impact**: Low in practice — only specific vars are used in `define`. But violates principle of least privilege.
- **Category**: Configuration Security
- **Fix**: Use `VITE_` prefix convention and change third arg to `"VITE_"`.
- **Effort**: Small

#### M3. NSM library cloned via git without integrity verification — RESOLVED (#67)
- **File**: `Dockerfile.nitro:11-12`
- **Issue**: `git clone -b v0.4.0` uses a tag (not a commit SHA). Tags can be force-updated on GitHub. No signature verification.
- **Category**: Supply Chain
- **Fix**: Pin to commit SHA: `git clone ... && cd ... && git checkout abc123def`.
- **Effort**: Trivial
- **Resolution**: Pinned to commit SHA `5798fec36f49e1d199c77947f4e51f86b663750f` (v0.4.0 tag). PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### M4. `s3:DeleteObject` unrestricted in CI IAM policy
- **File**: `infra/iam/tee-rex-ci-policy.json:95-107`
- **Issue**: CI role can delete any object in prod S3 bucket. A compromised workflow could wipe the production app.
- **Category**: IAM
- **Fix**: Scope delete permission more tightly, or separate the deploy role from the CI role.
- **Effort**: Medium

### Low

#### L1. CORS allows all origins
- **File**: `packages/server/src/index.ts:29`
- **Issue**: `app.use(cors())` — any origin can call the API. Acceptable because the server is behind CloudFront/VPC and requests are encrypted.
- **Category**: Accepted Risk

#### L2. Clock skew in attestation freshness check — RESOLVED (#67)
- **File**: `packages/sdk/src/lib/attestation.ts:112-117`
- **Issue**: No tolerance for clock drift between client and enclave. ±30s skew could reject valid attestations.
- **Category**: Edge Case
- **Fix**: Add tolerance: `docAge > maxAgeMs + 30000`.
- **Effort**: Trivial
- **Resolution**: Added `CLOCK_SKEW_TOLERANCE_MS = 30_000` to freshness comparison. PR [#67](https://github.com/alejoamiras/tee-rex/pull/67).

#### L3. OpenPGP version pinned exactly (6.3.0) but not audited
- **File**: `packages/sdk/package.json:43`
- **Issue**: Version is pinned (good for reproducibility) but no evidence of security audit of the specific version.
- **Category**: Supply Chain
- **Fix**: Check openpgp@6.3.0 for known CVEs. Consider using `npm audit`.
- **Effort**: Trivial

## Positive Security Properties

- Strong attestation: COSE_Sign1 + SHA384 + full certificate chain to AWS Root CA
- Encryption: curve25519 + AES-256-GCM (SEIPDv2) — modern and authenticated
- AWS Root CA PEM is hardcoded (prevents CA MITM)
- OIDC for CI — no long-lived AWS credentials
- Trust policy scoped to specific branches and PRs
- SSM instead of SSH — better audit trail, no open ports
- CloudFront prefix list for EC2 security groups
- Dynamic imports for crypto modules (browser-safe SDK)
- Zod validation on all API response parsing
