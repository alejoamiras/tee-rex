# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **SDK** (`/packages/sdk`): TypeScript package `@nemi-fi/tee-rex` - Remote proving client for Aztec
- **Server** (`/packages/server`): Express server that runs the prover in a TEE environment
- **Integration** (`/packages/integration`): Integration tests for the full proving flow
- **Build system**: Bun workspaces (`packages/*`)
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Commit hygiene**: Husky + lint-staged + commitlint (conventional commits)
- **CI**: GitHub Actions (per-package, path-filtered workflows)
- **Aztec version**: 4.0.0-nightly.20260204

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

### 4. Validation

Every step must include a validation strategy. Think about how to verify the step worked:

- **Code changes**: run `bun run lint` and `bun run test`
- **New tests**: run the specific test file (`bun test path/to/file.test.ts`) and verify it passes
- **Refactors**: run the full test suite to catch regressions
- **Config changes**: run the relevant command (e.g., `bun install`, `bun run build`)
- **New features**: write a test or run a manual verification script

If you're unsure how to validate a step, that's a sign the step might be too big — break it down further.

---

## Quick Start

```bash
# Install dependencies
bun install

# Run full checks (lint + typecheck + unit tests)
bun run test

# Run only linting
bun run lint

# Auto-fix lint/format issues
bun run lint:fix

# Run integration tests (auto-starts Aztec sandbox + tee-rex server)
bun run test:integration

# Run all tests
bun run test:all

# Start server
bun run start

# Build SDK
bun run sdk:build

# Build Docker image
bun run build
```

---

## Phase 1: Monorepo Migration to Bun ✅ Complete

**Goal**: Migrate from pnpm/turbo to Bun workspaces for faster builds and simpler tooling.

**Completed:**
- Replaced pnpm with Bun as package manager
- Removed Turbo, using Bun workspace commands instead
- Migrated SDK tests from vitest to bun:test
- Updated Dockerfile to use oven/bun:1.3-debian base image
- All commands now use `bun run`
- Restructured into `packages/` layout (sdk, server, integration)

---

## Phase 2: Integration Testing with Bun ✅ Complete

**Goal**: Create a proper integration test suite that runs with `bun test`.

**Completed:**
- Created `/packages/integration` workspace with test infrastructure
- **Automatic service management** - starts Aztec sandbox and tee-rex server if not running
- Connectivity tests for Aztec node and tee-rex server
- Full proving flow tests (TeeRexProver → TestWallet → Account deployment)
- Automatic cleanup of started services after tests
- Proper timeouts for long-running proving operations

**Environment variables:**
- `INTEGRATION_AUTO_START=false` - Disable automatic service startup
- `AZTEC_NODE_URL` - Custom Aztec node URL (default: http://localhost:8080)
- `TEEREX_URL` - Custom tee-rex server URL (default: http://localhost:4000)

**Note:** Requires `aztec` CLI to be installed for auto-start:
```bash
curl -fsSL https://install.aztec.network | bash
```

---

## Phase 3: Performance Benchmarking

**Goal**: Create a benchmarking system to measure proof generation performance across different machines.

**Requirements**:
- Measure proof generation time for different circuit sizes
- Compare performance across machines (local dev, cloud VMs, TEE environments)
- Store and visualize benchmark results
- Track performance regressions over time

**Status**: Not started

**Planning document**: See `/plans/phase-3-benchmarking.md`

---

## Phase 4: Testing & Demo Frontend

**Goal**: Proper unit/E2E test coverage + a demo frontend to showcase local vs remote proving speed.

**Parts:**
- **A** — Unit tests for server (`lazyValue`, `EncryptionService`, endpoints) and SDK (`encrypt`, expanded `TeeRexProver`)
- **B** — E2E tests for local proving, remote proving, and mode switching
- **C** — Vanilla TS + Vite demo page with a local/remote toggle and timing display

**Status**: Not started

**Planning document**: See `/plans/phase-4-testing-and-demo.md`

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen
