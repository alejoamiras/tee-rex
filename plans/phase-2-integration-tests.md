# Phase 2: Integration Testing Plan

> Status: **Not Started**
> Depends on: Phase 1 (Bun migration)

## Overview

Create a proper integration test suite that:
- Verifies full proving flow (SDK → Server → Proof)
- Works with local Aztec sandbox
- Runs with `bun test`
- Skips gracefully if sandbox unavailable (CI-friendly)

## Goals

1. Convert existing `integration-test.ts` to proper Bun tests
2. Make tests idempotent and repeatable
3. Add proper assertions (not just console.log)
4. Support partial test runs (levels)
5. Enable `bun run test:integration`

## Task List

### Phase 2.0: Research
- [ ] Study current `integration-test.ts` structure
- [ ] Research Bun test patterns for integration tests
- [ ] Determine test location (root `/tests` vs `/integration`)
- [ ] Design test file organization

### Phase 2.1: Test Infrastructure
- [ ] Create test directory structure
- [ ] Configure Bun test timeouts for integration
- [ ] Create test utilities for sandbox detection
- [ ] Create skip helpers for unavailable services

### Phase 2.2: Connectivity Tests
- [ ] Test: Aztec node connectivity
- [ ] Test: Tee-rex server connectivity
- [ ] Add skip logic if services unavailable

### Phase 2.3: Proving Flow Tests
- [ ] Test: TeeRexProver instantiation
- [ ] Test: TestWallet creation with TeeRexProver
- [ ] Test: Account registration
- [ ] Test: Account deployment (triggers proving)
- [ ] Test: Verify proof generation

### Phase 2.4: Commands
- [ ] Add `bun run test:integration` to root
- [ ] Add `bun run test:all` for complete suite
- [ ] Document test running instructions

## Verification

```bash
# Start sandbox first
aztec start --local-network

# Start tee-rex server
bun run --cwd server start

# Run integration tests
bun run test:integration
```
