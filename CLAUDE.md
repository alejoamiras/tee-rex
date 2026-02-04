# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **SDK** (`/sdk`): TypeScript package `@nemi-fi/tee-rex` - Remote proving client for Aztec
- **Server** (`/server`): Express server that runs the prover in a TEE environment
- **Integration** (`/integration`): Integration tests for the full proving flow
- **Build system**: Bun workspaces
- **Aztec version**: 4.0.0-nightly.20260204

---

## Phase 1: Monorepo Migration to Bun ✅ Complete

**Goal**: Migrate from pnpm/turbo to Bun workspaces for faster builds and simpler tooling.

**Completed:**
- Replaced pnpm with Bun as package manager
- Removed Turbo, using Bun workspace commands instead
- Migrated SDK tests from vitest to bun:test
- Updated Dockerfile to use oven/bun:1.3-debian base image
- All commands now use `bun run`

**Commands:**
```bash
bun install          # Install dependencies
bun run test         # Run lint + unit tests
bun run start        # Start server
bun run sdk:build    # Build SDK
bun run build        # Build Docker image
```

---

## Phase 2: Integration Testing with Bun ✅ Complete

**Goal**: Create a proper integration test suite that runs with `bun test`.

**Completed:**
- Created `/integration` workspace with test infrastructure
- **Automatic service management** - starts Aztec sandbox and tee-rex server if not running
- Connectivity tests for Aztec node and tee-rex server
- Full proving flow tests (TeeRexProver → TestWallet → Account deployment)
- Automatic cleanup of started services after tests
- Proper timeouts for long-running proving operations

**Commands:**
```bash
bun run test:integration  # Run integration tests (auto-starts services)
bun run test:all          # Run all tests (unit + integration)
```

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

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen

---

## Quick Start

```bash
# Install dependencies
bun install

# Run unit tests
bun run test

# Run integration tests (auto-starts Aztec sandbox + tee-rex server)
bun run test:integration

# Or run all tests
bun run test:all

# Build Docker image
bun run build
```
