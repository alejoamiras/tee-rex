# CI/CD Workflows Audit (`.github/`)

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: All 17 workflow files + 2 composite actions  

## Summary

The CI/CD system is well-designed with reusable workflows, OIDC-based AWS auth (no stored keys), dorny/paths-filter for change detection, and conditional deploys. Key concerns: SSM tunnel processes are never killed on failure (resource leak), `publish-sdk` is gated by a cheap smoke test instead of full validation, path filters don't include workflow file changes, and ports are hardcoded in 20+ locations.

## Findings

### Critical

#### C1. SSM tunnel processes leaked on job failure
- **Files**: `_deploy-tee.yml:180-191`, `_deploy-prover.yml` (similar), `_e2e-sdk.yml:60-93`, `_e2e-app.yml:60-93`, `deploy-prod.yml:211-243`
- **Issue**: Background SSM tunnel started with `&`, PID captured, but `kill $TUNNEL_PID` only executes on success path. If health check fails or e2e tests fail, the tunnel process persists until the runner is recycled.
- **Impact**: Port conflicts on subsequent runs, wasted resources, potential runner instability.
- **Category**: Process Management
- **Fix**: Use `trap 'kill $TUNNEL_PID 2>/dev/null' EXIT` immediately after starting the tunnel, or add a cleanup step with `if: always()`.
- **Effort**: Small

### High

#### H1. `publish-sdk` gated by cheap smoke test, not full validation
- **File**: `deploy-prod.yml:163`
- **Issue**: `publish-sdk` depends on `nextnet-check` (3 API calls, ~1 min) not on `validate-prod` (full Playwright e2e, ~30 min). `validate-prod` has `continue-on-error: true`, so its failure doesn't block anything.
- **Impact**: A broken deploy could result in a broken SDK being published to npm.
- **Category**: Release Safety
- **Fix**: Already documented in CLAUDE.md backlog. Make `publish-sdk` depend on `validate-prod.conclusion == 'success'` for auto-update merges. Keep `nextnet-check` as fallback for manual triggers.
- **Effort**: Medium

#### H2. Path filters don't include workflow file changes
- **File**: `deploy-prod.yml:36-48`
- **Issue**: The `servers` filter includes `Dockerfile*`, `infra/**`, `packages/server/**` but NOT `.github/workflows/deploy-prod.yml` or `.github/workflows/_deploy-*.yml`. If a deploy workflow itself changes, no deploys will trigger.
- **Impact**: Workflow bugs won't be caught by the deploy pipeline until a server/infra file also changes.
- **Category**: CI Correctness
- **Fix**: Add `.github/workflows/deploy-prod.yml`, `.github/workflows/_deploy-*.yml`, `.github/workflows/_build-base.yml` to the `servers` filter. Add `.github/workflows/_e2e-app.yml` to the `app` filter.
- **Effort**: Trivial

#### H3. Required secrets not validated before use
- **Files**: `_deploy-tee.yml:42`, `_deploy-prover.yml:42`, `_build-base.yml:48`
- **Issue**: Instance IDs and ECR registry are read from secrets without validation. If a secret is missing, the conditional `inputs.environment == 'prod' && secrets.PROD_TEE_INSTANCE_ID || ...` returns empty string, and AWS API calls fail with cryptic errors.
- **Impact**: Silent failures with unclear error messages. Debugging requires reading workflow logs carefully.
- **Category**: Error Handling
- **Fix**: Add a validation step at the top of deploy jobs: `if [ -z "$INSTANCE_ID" ]; then echo "::error::INSTANCE_ID not set"; exit 1; fi`.
- **Effort**: Small

### Medium

#### M1. Health check timeout asymmetry
- **Files**: `_deploy-tee.yml:186-198`, `_deploy-prover.yml` (similar)
- **Issue**: SSM tunnel has 10 min startup timeout, but health check is only 60s (30 attempts × 2s). If the tunnel takes 9 minutes to come online, the health check will timeout while the tunnel is still initializing.
- **Category**: Timing
- **Fix**: Increase health check to 2-3 minutes (60 attempts × 2s).
- **Effort**: Trivial

#### M2. Ports hardcoded in 20+ locations
- **Files**: Multiple workflows and scripts
- **Issue**: TEE port 4000/4001, prover port 80/4002 appear as magic numbers across workflows, deploy scripts, and health checks.
- **Impact**: If ports change, many files need updates. Easy to miss one.
- **Category**: Maintainability
- **Fix**: Define as workflow-level env vars or inputs to reusable workflows.
- **Effort**: Small

#### M3. ECR repository name `tee-rex` hardcoded
- **Files**: `_build-base.yml:52`, `_deploy-tee.yml`, `_deploy-prover.yml` (10+ places)
- **Issue**: The string `tee-rex` appears as a hardcoded ECR repo name throughout.
- **Category**: Maintainability
- **Fix**: Use a secret or workflow variable `ECR_REPO_NAME`.
- **Effort**: Small

#### M4. `docker image prune -af` too aggressive in deploy scripts
- **Files**: `infra/ci-deploy-prover.sh:39`, `infra/ci-deploy.sh`
- **Issue**: Deletes ALL unused images, not just tee-rex ones. If other services run on the EC2 instance, their images are deleted.
- **Category**: Safety
- **Fix**: Add filter: `docker image prune -af --filter "label=app=tee-rex"` (requires adding label to Dockerfile).
- **Effort**: Small

#### M5. Aztec version detection has no error handling
- **Files**: `_publish-sdk.yml:54`, `setup-aztec/action.yml:31`, `aztec-spartan.yml:42`
- **Issue**: `node -p "require('./package.json').dependencies['@aztec/stdlib']"` throws if @aztec/stdlib is missing from dependencies. No fallback or helpful error message.
- **Category**: Error Handling
- **Fix**: Add validation: `node -p "const v = require('./package.json').dependencies['@aztec/stdlib']; if (!v) throw 'Missing @aztec/stdlib dep'; console.log(v)"`.
- **Effort**: Trivial

### Low

#### L1. No job summary annotations for PRs
- **Files**: All workflows
- **Issue**: Workflows don't use GitHub's `$GITHUB_STEP_SUMMARY` for PR annotations. Deploy results, test counts, and timing aren't surfaced in the PR UI.
- **Category**: DX
- **Fix**: Add summary markdown in key steps.
- **Effort**: Small

#### L2. Inconsistent step naming across workflows
- **Issue**: Some use "Check trigger", others "Detect changes". Some echo with `echo "::error::"`, others plain `echo`.
- **Category**: Consistency
- **Fix**: Standardize naming conventions.
- **Effort**: Trivial

#### L3. Artifact retention not configured
- **Files**: `_e2e-sdk.yml`, `_e2e-app.yml` (log uploads)
- **Issue**: Aztec logs uploaded but no retention policy set (defaults to 90 days).
- **Category**: Cost
- **Fix**: Add `retention-days: 7` to artifact upload steps.
- **Effort**: Trivial

#### L4. Playwright installed twice on fullstack e2e runs
- **Files**: `app.yml:93`, `_e2e-app.yml:101`
- **Issue**: Mocked e2e job and fullstack e2e job both install Playwright separately.
- **Category**: Efficiency
- **Fix**: Cache Playwright browsers or share installation via artifact.
- **Effort**: Small

## Positive Notes

- OIDC auth throughout — no long-lived AWS keys
- `dorny/paths-filter` with `workflow_dispatch` override is elegant
- Gate job pattern (`*-status` with `always()`) works well with branch protection
- Reusable workflows are well-parameterized (environment, base_tag, dist_tag)
- Conditional deploys in deploy-prod.yml save ~50 min on app-only changes
- `_build-base.yml` is idempotent (checks ECR before building)
- Docker registry cache used consistently
- `concurrency` with `cancel-in-progress` prevents queued runs
