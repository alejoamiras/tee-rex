# Tee-Rex Development Roadmap

This document outlines the planned improvements for the tee-rex project.

## Current State

- **SDK** (`/sdk`): TypeScript package `@nemi-fi/tee-rex` - Remote proving client for Aztec
- **Server** (`/server`): Express server that runs the prover in a TEE environment
- **Build system**: Currently using pnpm + turbo
- **Aztec version**: 4.0.0-nightly.20260204

---

## Phase 1: Monorepo Migration to Bun

**Goal**: Migrate from pnpm/turbo to Bun workspaces for faster builds and simpler tooling.

**Why Bun?**
- Faster package installation and script execution
- Built-in workspace support
- Native TypeScript execution (no tsx needed)
- Simpler configuration

**Status**: Not started

**Planning document**: See `/plans/phase-1-bun-migration.md` (to be created in plan mode)

---

## Phase 2: Integration Testing with Bun

**Goal**: Create a proper integration test suite that runs with `bun test`.

**Requirements**:
- Tests should verify full proving flow (SDK → Server → Proof)
- Should work with local Aztec sandbox
- Iterative test levels (connectivity → proving → verification)
- CI-friendly (can skip if sandbox not available)

**Status**: Not started (depends on Phase 1)

**Planning document**: See `/plans/phase-2-integration-tests.md` (to be created in plan mode)

---

## Phase 3: Performance Benchmarking

**Goal**: Create a benchmarking system to measure proof generation performance across different machines.

**Requirements**:
- Measure proof generation time for different circuit sizes
- Compare performance across machines (local dev, cloud VMs, TEE environments)
- Store and visualize benchmark results
- Track performance regressions over time

**Status**: Not started (depends on Phase 2)

**Planning document**: See `/plans/phase-3-benchmarking.md` (to be created in plan mode)

---

## Development Principles

1. **Iterative implementation**: Each phase should be broken into small, testable steps
2. **Research first**: Before making changes, understand the current system and potential impacts
3. **Preserve functionality**: Each step should maintain backward compatibility where possible
4. **Test at each step**: Verify the system works before moving to the next step
5. **Document decisions**: Record why certain approaches were chosen

---

## How to Use This Document

When working on any phase:
1. Enter plan mode for that phase
2. Research the current state and requirements
3. Create a detailed task list with iterative steps
4. Execute tasks one at a time, verifying at each step
5. Update this document with status and learnings
