# Phase 1: Bun Migration Plan

> Status: **In Progress**

## Spike Results (Completed)

**Bun is compatible with @aztec packages** with one caveat for testing:

1. All @aztec package imports work (bb-prover, foundation, stdlib, simulator)
2. Direct TS execution works (`bun run src/index.ts`)
3. Server runs successfully under Bun
4. **Tests require a workaround**: @aztec/foundation uses vitest's `expect.addEqualityTesters` API

**Test workaround pattern**:
```typescript
import { describe, expect, test, beforeAll } from "bun:test";

// Patch expect for @aztec/foundation compatibility
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Use dynamic imports for @aztec modules
let WASMSimulator: typeof import("@aztec/simulator/client").WASMSimulator;
beforeAll(async () => {
  const simulator = await import("@aztec/simulator/client");
  WASMSimulator = simulator.WASMSimulator;
});
```

**Additional requirements**:
- Add `bun-types` to devDependencies
- Update tsconfig: `"types": ["bun-types"]`
- Exclude test files from build: `"exclude": ["src/**/*.test.ts"]`

---

## Overview

Migrate from pnpm/turbo to Bun workspaces. Full migration (dropping Turbo) because:
- Only 2 packages with no inter-package dependencies
- Most Turbo tasks have `cache: false` already
- Bun provides native TS execution, testing, and workspace management
- Reduces tooling complexity from 3 tools to 1

## Critical Files

| File | Change |
|------|--------|
| `/package.json` | Add `workspaces`, remove `packageManager`, remove turbo |
| `/pnpm-workspace.yaml` | Delete |
| `/pnpm-lock.yaml` | Delete (replaced by bun.lockb) |
| `/turbo.jsonc` | Delete |
| `/Dockerfile` | Rewrite for oven/bun base image |
| `/sdk/package.json` | Update scripts, remove vitest/tsx |
| `/server/package.json` | Update scripts, remove tsx |
| `/sdk/src/TeeRexProver.test.ts` | Change vitest import to bun:test |
| `/sdk/vitest.config.ts` | Delete (replaced by bunfig.toml) |

## Task List

### Phase 1.0: Spike - Validate Bun Compatibility
**Goal**: Ensure Bun works with @aztec packages before committing

- [ ] Create spike branch `spike/bun-compatibility`
- [ ] Install Bun globally: `curl -fsSL https://bun.sh/install | bash`
- [ ] Test @aztec imports: Create test file that imports bb-prover
- [ ] Test openpgp crypto operations
- [ ] Test direct TS execution: `bun run sdk/src/index.ts`
- [ ] Test direct TS execution: `bun run server/src/index.ts`
- [ ] Document any incompatibilities

**Verification**: All imports work, no runtime errors
**Rollback Point**: If fails, abort migration

### Phase 1.1: Package Manager Swap
**Goal**: Replace pnpm with Bun as package manager

- [ ] Create branch `feat/bun-migration`
- [ ] Update root package.json:
  ```json
  {
    "private": true,
    "workspaces": ["sdk", "server"],
    "scripts": { ... }
  }
  ```
- [ ] Delete `/pnpm-workspace.yaml`
- [ ] Delete `/pnpm-lock.yaml`
- [ ] Run `bun install`
- [ ] Verify `bun.lockb` created
- [ ] Verify `node_modules/@aztec` packages exist

**Verification**: `bun install` succeeds

### Phase 1.2: SDK Package Migration
**Goal**: Migrate SDK scripts and tests to Bun

- [ ] Update SDK package.json scripts:
  - `vitest run` → `bun test`
  - `pnpm` → `bun run`
- [ ] Update test imports: `vitest` → `bun:test`
- [ ] Create `/sdk/bunfig.toml`:
  ```toml
  [test]
  timeout = 600000
  ```
- [ ] Delete `/sdk/vitest.config.ts`
- [ ] Remove devDependencies: `vitest`, `tsx`
- [ ] Run tests: `bun run test:unit`
- [ ] Run build: `bun run build`

**Verification**: Tests pass, dist/ created

### Phase 1.3: Server Package Migration
**Goal**: Migrate server to use Bun runtime

- [ ] Update server scripts:
  - `tsx --watch src/index.ts` → `bun --watch run src/index.ts`
  - `tsx src/index.ts` → `bun run src/index.ts`
- [ ] Remove devDependency: `tsx`
- [ ] Start server: `bun run start`
- [ ] Test endpoint: `curl http://localhost:4000/encryption-public-key`

**Verification**: Server starts and responds

### Phase 1.4: Root Task Orchestration
**Goal**: Replace Turbo with Bun workspace commands

- [ ] Update root package.json scripts:
  ```json
  {
    "scripts": {
      "build": "docker build -t tee-rex --platform linux/amd64 .",
      "dev": "bun run --filter '*' dev",
      "start": "bun run --cwd server start",
      "test": "bun run test:lint && bun run test:unit",
      "test:lint": "bun run --filter '*' test:lint",
      "test:unit": "bun run --filter '*' test:unit"
    }
  }
  ```
- [ ] Delete `/turbo.jsonc`
- [ ] Remove root devDependency: `turbo`
- [ ] Test: `bun run test` from root

**Verification**: Root commands work

### Phase 1.5: Docker Migration
**Goal**: Update Dockerfile for Bun

- [ ] Update Dockerfile:
  ```dockerfile
  FROM oven/bun:1.1-ubuntu

  RUN apt update && apt install -y git build-essential libc++-dev python3 && rm -rf /var/lib/apt/lists/*

  WORKDIR /app

  COPY package.json bun.lockb ./
  COPY sdk/package.json ./sdk/
  COPY server/package.json ./server/

  RUN bun install --frozen-lockfile

  COPY . .

  EXPOSE 80
  ENV PORT=80

  WORKDIR /app/server
  CMD ["bun", "run", "src/index.ts"]
  ```
- [ ] Build: `docker build -t tee-rex --platform linux/amd64 .`
- [ ] Run: `docker run -p 4000:80 tee-rex`
- [ ] Test: `curl http://localhost:4000/encryption-public-key`

**Verification**: Container builds and runs

### Phase 1.6: Cleanup
**Goal**: Final cleanup and commit

- [ ] Update `.gitignore`:
  - Remove: `.turbo`, `.pnpm-store`
  - Add: `.bun`
- [ ] Add `bun-types` to root devDependencies
- [ ] Update root tsconfig: `"types": ["bun-types"]`
- [ ] Final test of all commands
- [ ] Commit and create PR

## Risks

| Risk | Mitigation |
|------|------------|
| @aztec WASM incompatible | Spike testing first |
| Docker native modules fail | Keep Node.js Dockerfile as backup |
| Express behavior differences | Test all endpoints specifically |

## Verification Checklist

After migration complete:

```bash
bun install                    # ✓ Dependencies install
bun run test                   # ✓ All tests pass
bun run --cwd sdk build        # ✓ SDK builds
bun run --cwd server start     # ✓ Server starts
docker build -t tee-rex .      # ✓ Docker builds
docker run -p 4000:80 tee-rex  # ✓ Container runs
```
