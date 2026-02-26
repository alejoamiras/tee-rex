# Phase 28A+C: Generalized Aztec Auto-Update Pipeline

## Lessons Learned

### 1. Reusable workflows cannot have `concurrency` or `permissions` at workflow level

| Attempt | Approach | Result |
|---------|----------|--------|
| 1 | Put `concurrency` and `permissions` at top level of `_aztec-update.yml` (a `workflow_call` reusable workflow) | **Failed** — GitHub Actions reports `startup_failure` with no useful error message. Both `aztec-nightlies.yml` and `aztec-devnet.yml` failed immediately. |
| 2 | Moved `concurrency` and `permissions` to the caller workflows (`aztec-nightlies.yml` and `aztec-devnet.yml`) | **Worked** — reusable workflow inherits permissions from caller; concurrency groups defined on caller. |

**Key insight**: `workflow_call` workflows cannot have `concurrency` or `permissions` at the workflow level. These must be on the calling workflow. GitHub doesn't give a clear error — it just fails with `startup_failure`.

### 2. New workflow files only work via `workflow_dispatch` once merged to default branch

The `aztec-devnet.yml` workflow could not be dispatched until the file existed on `main`. After merging PR #127, dispatch worked.

### 3. Devnet branch divergence

When the `_aztec-update.yml` reusable workflow was merged to `main`, the `devnet` branch didn't have it yet. The devnet auto-updater checks out the `devnet` branch, so it also needed the new scripts (`check-aztec-update.ts`). Fixed by cherry-picking the relevant commits from main to devnet.

**Key insight**: When adding shared infrastructure (reusable workflows, scripts) that are used by workflows targeting non-main branches, those branches need the changes too. Cherry-pick or merge from main.
