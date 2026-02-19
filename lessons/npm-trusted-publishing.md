# npm Trusted Publishing: One Workflow Per Package

## Problem

npm OIDC trusted publishing only supports **one workflow file per package**. When a reusable workflow (`_publish-sdk.yml`) is called via `workflow_call`, npm validates the **caller** workflow filename — not the reusable one.

With two callers (`deploy-prod.yml` and `deploy-devnet.yml`), only one can be configured as the trusted publisher. The other gets a 404/permission error.

## Decision

Switched from OIDC trusted publishing to an **npm automation token** (`NPM_TOKEN` repo secret).

- `--provenance` still works with tokens (npm CLI 11+)
- Token is scoped to publish-only, stored in GitHub encrypted secrets
- Both deploy workflows can publish via `secrets: inherit`

## References

- npm docs: https://docs.npmjs.com/trusted-publishers/
- Limitation confirmed: "Each package can have only one trusted publisher configured at a time"
- PR that introduced the change: Phase 23C (devnet branch setup)
