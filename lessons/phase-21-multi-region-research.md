# Phase 21: Multi-Region Strategy — Research Findings

**Date**: 2026-02-15
**Status**: Research complete — no implementation

---

## 1. Optimal AWS Regions

| Office | Closest Region | Distance | Expected Latency |
|--------|---------------|----------|-----------------|
| Buenos Aires | `sa-east-1` (São Paulo) | ~1,700 km | ~30-50ms |
| London | `eu-west-2` (London) | Local | <10ms |

**Current setup**: Everything in `eu-west-2`. Argentine users face ~200-300ms round-trip to London for prover/TEE API calls.

---

## 2. Nitro Enclaves Availability

**No blockers.** As of October 2025, Nitro Enclaves is available in **all AWS regions**, including sa-east-1.

- `m5.xlarge` (current TEE instance): supported in both regions
- `t3.xlarge` (current prover): doesn't need enclaves (burstable, not enclave-capable)
- No regional feature differences for Nitro Enclaves

**Not supported**: Outposts, Local Zones, Wavelength Zones, bare metal instances.

---

## 3. ECR Cross-Region Strategy

### Recommendation: ECR Cross-Region Replication (not multi-push)

| Aspect | Replication | Multi-Push |
|--------|------------|------------|
| Setup | Configure once at registry level | Modify every CI workflow |
| Reliability | AWS backbone handles it | Each push can fail independently |
| Latency | ~15s for a 500MB image | Doubled CI time |
| Cost | Same | Same |
| Maintenance | Zero | Region loops in workflows |

**How to set up**:
1. Configure replication rule: `eu-west-2` → `sa-east-1`
2. Add prefix filter: `prod` (only replicate production images)
3. Push once to eu-west-2, images auto-replicate to sa-east-1
4. EventBridge fires when replication completes (can gate deploys)

**IAM**: Current OIDC role works — add `aws:RequestedRegion` condition for `["eu-west-2", "sa-east-1"]`.

**Cost**: ~$0.09/GB cross-region transfer × 2GB × ~30 deploys/month = ~$5-10/month.

---

## 4. Geo-Routing Options

### Recommended: Lambda@Edge or CloudFront Functions for dynamic origin selection

| Option | Complexity | Cost | Fits Architecture? |
|--------|-----------|------|-------------------|
| **CloudFront Functions (geo-routing)** | Low | Free (<2M invocations) | Yes — single distribution |
| **Lambda@Edge (origin-request)** | Medium | ~$0.60/M requests | Yes — more flexible |
| **Route 53 latency routing** | High | Requires custom domain | No — no domain currently |
| **Multiple CF distributions** | High | Requires custom domain + Route 53 | No |
| **Origin Groups (failover)** | Low | Free | No geo-routing, just failover |

### How it would work (CloudFront Functions approach):

```
CloudFront (single distribution)
  ├── CF Function inspects CloudFront-Viewer-Country header
  │
  ├── South America (AR, BR, CL, UY, PY, etc.)
  │   ├── /prover/* → sa-east-1 Prover EC2
  │   └── /tee/*    → sa-east-1 TEE EC2
  │
  └── Everything else (EU, NA, etc.)
      ├── /prover/* → eu-west-2 Prover EC2
      └── /tee/*    → eu-west-2 TEE EC2
```

**Important caveat**: CloudFront Functions run at the **viewer-request** stage and can modify the request, but **cannot dynamically change the origin** in a viewer-request function. To dynamically select origins based on geography, you need **Lambda@Edge at the origin-request stage**, which can modify `event.Records[0].cf.request.origin`.

**Alternative simpler approach**: Use **two path prefixes** (`/prover/*` → eu-west-2, `/prover-sa/*` → sa-east-1) with a **CloudFront Function** that rewrites based on viewer country. This avoids Lambda@Edge entirely:

```javascript
function handler(event) {
  var request = event.request;
  var country = request.headers['cloudfront-viewer-country']
    ? request.headers['cloudfront-viewer-country'].value
    : '';
  var saCountries = ['BR','AR','CL','UY','PY','BO','PE','EC','CO','VE'];

  if (saCountries.includes(country)) {
    // Rewrite /prover/... to /prover-sa/... (hits sa-east-1 origin)
    request.uri = request.uri
      .replace(/^\/prover\//, '/prover-sa/')
      .replace(/^\/tee\//, '/tee-sa/');
  }
  return request;
}
```

Then configure CloudFront with 5 cache behaviors:
- `/prover-sa/*` → sa-east-1 prover EC2
- `/tee-sa/*` → sa-east-1 TEE EC2
- `/prover/*` → eu-west-2 prover EC2
- `/tee/*` → eu-west-2 TEE EC2
- `/*` → S3 (static app)

**CloudFront Price Class**: Must upgrade from `PriceClass_100` (NA + EU) to `PriceClass_200` or `PriceClass_All` to serve South American edge locations. Otherwise SA users get routed to North American edges, adding latency.

---

## 5. IaC Tooling Assessment

### Current approach: Shell scripts + GitHub Actions + JSON configs

Works fine for single region. **Multi-region is the breaking point** — would require:
- Duplicating/parameterizing all deploy scripts
- Doubling GitHub secrets (instance IDs per region)
- Manual coordination of cross-region dependencies
- No drift detection across 2 regions

### Tool comparison

| Tool | Multi-Region | Learning Curve | TypeScript | License | Verdict |
|------|-------------|---------------|------------|---------|---------|
| **OpenTofu** | Excellent (`for_each` providers) | Medium (HCL) | No | MPL 2.0 (open source) | Best overall |
| **Terraform** | Excellent (Stacks in 1.7+) | Medium (HCL) | No | BSL (not open source) | Same as OpenTofu but license risk |
| **Pulumi** | Good (region-aware v7.0) | Medium (TS) | Yes | Apache 2.0 | Familiar language, smaller ecosystem |
| **AWS CDK** | Good (cross-region refs) | Medium-High | Yes | Apache 2.0 | AWS lock-in |
| **Keep scripts** | Poor | None | N/A | N/A | Not viable for 2+ regions |

### Recommendation

**For the MVP**: Keep current scripts, add sa-east-1 manually. The MVP only doubles the infra — manageable with scripts if parameterized well.

**For long-term (3+ regions or frequent env creation)**: Adopt **OpenTofu**. Same syntax/ecosystem as Terraform, fully open source, `for_each` provider blocks make multi-region clean.

**When to adopt IaC**:
- When you add a 3rd region
- When you need staging/preview environments
- When drift detection becomes a problem
- When you want to open-source the infra setup

---

## 6. Cost Analysis

### Current single-region costs (eu-west-2)

| Resource | Monthly Cost |
|----------|-------------|
| Prod TEE (m5.xlarge, 24/7) | ~$145 |
| Prod Prover (t3.xlarge, 24/7) | ~$122 |
| CI instances (stopped most of the time) | ~$5-8 |
| ECR (2GB) | ~$0.20 |
| S3 (app) | ~$0.01 |
| Elastic IPs (2, associated) | $0 |
| CloudFront (PriceClass_100) | Variable |
| **Total (excl. traffic)** | **~$272** |

### Dual-region costs (eu-west-2 + sa-east-1)

sa-east-1 has a ~20-30% premium over EU regions.

| Resource | Monthly Cost |
|----------|-------------|
| **Existing eu-west-2 infra** | ~$272 |
| sa-east-1 TEE (m5.xlarge, 24/7) | ~$175 |
| sa-east-1 Prover (t3.xlarge, 24/7) | ~$145 |
| sa-east-1 CI instances | ~$5-8 |
| ECR replication (cross-region) | ~$5-10 |
| Elastic IPs (2 more, associated) | $0 |
| CloudFront upgrade to PriceClass_200 | +$15-30 |
| **Total (excl. traffic)** | **~$617-640** |
| **Delta** | **+$345-368 (~+127%)** |

### Cost optimization

| Strategy | Savings |
|----------|---------|
| **Prover-only MVP** (skip sa-east-1 TEE) | -$175/month |
| **1-year Reserved Instances** | ~40% off EC2 (~-$130/month on new instances) |
| **Smaller prover** (t3.large instead of t3.xlarge) | -$50-70/month |
| **Stop sa-east-1 CI instances** (test in eu-west-2 only) | -$5-8/month |

**Most cost-effective MVP**: sa-east-1 prover only = **~$160/month** additional.

---

## 7. Simplest MVP

### Phased rollout

```
Phase 21A: ECR cross-region replication (eu-west-2 → sa-east-1)
    │       Effort: ~1 hour. Cost: ~$5-10/month.
    ▼
Phase 21B: Deploy sa-east-1 prover (t3.xlarge)
    │       Effort: ~4 hours (EC2 + EIP + SG + deploy script + CI secrets).
    │       Cost: +$145/month.
    ▼
Phase 21C: CloudFront geo-routing (CF Function + new origins)
    │       Effort: ~4 hours (CF Function, new cache behaviors, test).
    │       Cost: +$15-30/month.
    ▼
Phase 21D: Deploy sa-east-1 TEE (m5.xlarge)  [optional, defer if budget-constrained]
    │       Effort: ~4 hours (same as prover + Nitro Enclave setup).
    │       Cost: +$175/month.
    ▼
Phase 21E: Monitoring + validation
            Effort: ~2 hours (CloudWatch dashboards, latency tests).
            Cost: ~$0.
```

### Why prover-first?

1. Proving is the **slowest operation** — latency reduction has the biggest UX impact
2. Prover is simpler to deploy (standard Docker, no Nitro Enclave)
3. TEE attestation is a one-time check per session — less latency-sensitive
4. Lower risk — if something breaks, only non-TEE proving is affected

### Expected latency improvement

| Operation | Current (eu-west-2 only) | With sa-east-1 (from Buenos Aires) |
|-----------|-------------------------|-------------------------------------|
| Prover API call | ~200-300ms RTT | ~30-50ms RTT |
| TEE attestation | ~200-300ms RTT | ~30-50ms RTT (if Phase 21D done) |
| Static app load | <50ms (CF edge) | <50ms (CF edge, need PriceClass_200) |

---

## 8. Decision Summary

| Question | Answer |
|----------|--------|
| **Best regions?** | sa-east-1 (São Paulo) + eu-west-2 (London) — already using London |
| **ECR strategy?** | Cross-region replication (configure once, push once) |
| **Geo-routing?** | CloudFront Function with path rewriting (no custom domain needed) |
| **Nitro Enclaves in sa-east-1?** | Yes — fully supported since Oct 2025 |
| **IaC tooling?** | Keep scripts for MVP; adopt OpenTofu at 3+ regions |
| **Monthly cost increase?** | +$160 (prover-only MVP) to +$360 (full dual-region) |
| **Simplest MVP?** | sa-east-1 prover + CloudFront geo-routing (~$160/month, ~8 hours effort) |
