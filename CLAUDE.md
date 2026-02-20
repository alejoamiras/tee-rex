# Tee-Rex

## Current State

- **Repo**: `alejoamiras/tee-rex` (GitHub)
- **SDK** (`/packages/sdk`): TypeScript package `@alejoamiras/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **App** (`/packages/app`): Vite + vanilla TS frontend — local/remote/TEE mode toggle, timing, token flow
- **Build system**: Bun workspaces (`packages/sdk`, `packages/server`, `packages/app`)
- **Linting/Formatting**: Biome (lint + format in one tool), shellcheck (shell scripts), actionlint (GitHub Actions workflows), sort-package-json (`package.json` key ordering)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits). lint-staged runs Biome on `*.{ts,tsx,js,jsx}`, shellcheck on `*.sh`, actionlint on `.github/workflows/*.yml`, and `sort-package-json` on `**/package.json`.
- **CI**: GitHub Actions (per-package workflows with gate jobs: `sdk.yml`, `app.yml`, `server.yml`; shell & workflow lint: `actionlint.yml`; nightlies: `aztec-nightlies.yml`; infra: `infra.yml` (combined TEE+Remote), `tee.yml`, `remote.yml`; deploy: `deploy-prod.yml`, `deploy-devnet.yml`; reusable: `_build-base.yml`, `_deploy-tee.yml`, `_deploy-prover.yml`, `_publish-sdk.yml`)
- **Testing**: Each package owns its own unit tests (`src/`) and e2e tests (`e2e/`). E2e tests fail (not skip) when services unavailable.
- **Test structure convention**: Group tests under the subject being tested, nest by variant — don't create separate files per variant when they share setup. Example: `describe("TeeRexProver")` > `describe("Remote")` / `describe("Local")` / `describe.skipIf(...)("TEE")`. Extract shared logic (e.g., `deploySchnorrAccount()`) into helpers within the file.
- **Aztec version**: 5.0.0-nightly.20260220

**Reference docs** (read on demand, not on every task):
- **`docs/roadmap.md`** — completed phases, architectural decisions & gotchas, backlog. Read when working on infra, CI, deploy, or referencing past work.
- **`docs/ci-pipeline.md`** — CI/CD pipeline reference (workflow diagrams, job details, change detection).
- **`lessons/`** — per-phase lessons learned, debugging logs, approach tracking.

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

For every task, before starting implementation:

- **Read existing tests** for the packages you're modifying (`src/*.test.ts` for unit, `e2e/` for integration/Playwright)
- **Evaluate whether your changes need new or updated tests** — ask: "does this change behavior that existing tests cover? Does it add new behavior that should be tested?"
- **Skip adding tests only for truly miscellaneous changes** (docs-only, comments, config tweaks with no behavioral impact)
- **Add tests incrementally** — write the test alongside or immediately after the code change, not as a batch at the end
- **Real-data integration tests for external protocols** — when code processes data from external systems (attestation documents, CBOR/protobuf, API responses, binary protocols), **never rely solely on synthetic test data**. Always include at least one `describe.skipIf(!ENV_VAR)` integration test that runs against real production data.

### 5. Validation

Every step must include a validation strategy:

- **Code changes**: run `bun run lint` and `bun run test`
- **Shell script changes**: run `bun run lint:shell` (shellcheck)
- **Workflow changes**: run `bun run lint:actions` (actionlint)
- **New tests**: run the specific test file (`bun test path/to/file.test.ts`) and verify it passes
- **Refactors**: run the full test suite to catch regressions
- **Config changes**: run the relevant command (e.g., `bun install`, `bun run build`)

If you're unsure how to validate a step, that's a sign the step might be too big — break it down further.

### 6. Local validation gate

Before pushing to CI, run the **full local validation suite**. CI round-trips are expensive (10-15 min) — local validation takes under 2 minutes.

**Required before every push:**
1. `bun run test` — lint + typecheck + unit tests across all packages
2. `bun run lint:actions` — actionlint on any modified workflow files

**Only push when local validation is fully green.**

### 7. Documentation

After any structural change, **update the relevant docs in the same PR**:

- **`CLAUDE.md`** — project state, workflow, commands
- **`docs/roadmap.md`** — phase completions, architectural decisions, backlog
- **`docs/ci-pipeline.md`** — CI/CD pipeline changes
- **`lessons/`** — debugging logs, approach tracking

### 8. Branch, commit & CI

1. **Create a feature branch** from `main` (e.g., `feat/feature-name`, `fix/bug-name`)
2. **Commit** with a conventional commit message (`feat:`, `fix:`, `refactor:`, `ci:`, `docs:`, etc.)
3. **Push** and create a PR via `gh pr create`
4. **Watch the CI run** with `gh pr checks <PR_NUMBER> --watch`
5. **If CI fails**: fix, push, and watch again

---

## Quick Start

```bash
bun install              # Install dependencies
bun run test             # Full checks (lint + typecheck + unit tests)
bun run lint             # Linting only (biome + shellcheck + sort-package-json)
bun run lint:shell       # Lint shell scripts only
bun run lint:actions     # Lint GitHub Actions workflows
bun run lint:fix         # Auto-fix lint/format issues
bun run test:e2e         # E2E tests (requires Aztec local network + server)
bun run test:e2e:nextnet # Nextnet smoke test (requires internet)
bun run test:all         # All tests (lint + typecheck + unit + e2e)
bun run start            # Start server
bun run sdk:build        # Build SDK
bun run build            # Build Docker image
```

---

## Development Principles

1. **Iterative implementation**: Break into small, testable steps
2. **Research first**: Understand the current system before changing it
3. **Preserve functionality**: Maintain backward compatibility where possible
4. **Test at each step**: Verify before moving on
5. **Document decisions**: Record why approaches were chosen
6. **Track lessons**: Record every approach and outcome in `lessons/`. Check before trying new approaches. Stop after 3+ failures to reassess.
