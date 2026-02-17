# Documentation & Developer Experience Audit

**Date**: 2026-02-16  
**Status**: Complete  
**Files reviewed**: README.md, SDK README, CLAUDE.md, docs/, lessons/, JSDoc in source  

## Summary

Documentation is polarized: CLAUDE.md is comprehensive (383 lines of roadmap, architecture decisions, and lessons) but README.md is minimal (23 lines). The SDK has a decent README but no API reference. Source code has sparse JSDoc comments. There's no architecture diagram, contribution guide, or onboarding document for new developers.

## Findings

### High

#### H1. Root README.md is minimal (23 lines)
- **File**: `README.md`
- **Issue**: For a repository being presented to a team, the README is the first impression. Currently it's essentially just a title and basic description with no setup instructions, architecture overview, or links to documentation.
- **Impact**: New developers cannot understand the project from the README alone.
- **Category**: First Impression
- **Fix**: Add: project description, architecture diagram, quick start, link to docs/, link to SDK readme.
- **Effort**: Medium

#### H2. No architecture diagram
- **Issue**: The system has a non-trivial architecture (SDK → Server → Nitro Enclave, CloudFront → S3/EC2, multi-env). There's no visual diagram anywhere. CLAUDE.md has ASCII art but it's in a development roadmap file, not visible to newcomers.
- **Category**: Comprehension
- **Fix**: Create a Mermaid diagram in README.md or docs/architecture.md showing: client → CloudFront → S3/Prover/TEE, SDK ↔ Server attestation flow.
- **Effort**: Small

#### H3. No API reference for SDK
- **File**: `packages/sdk/README.md` (92 lines)
- **Issue**: README has installation and basic usage but no comprehensive API reference. `TeeRexProver`, `verifyNitroAttestation`, attestation options, and error types are not fully documented.
- **Category**: SDK Usability
- **Fix**: Add a full API reference section to SDK README or generate docs with TypeDoc.
- **Effort**: Medium

### Medium

#### M1. CLAUDE.md is the primary documentation but not discoverable
- **File**: `CLAUDE.md` (383 lines)
- **Issue**: Contains the most detailed documentation (quick start, architecture decisions, phase history, deployment lessons) but is named for Claude Code AI assistant, not for human developers. A new team member wouldn't know to read it.
- **Category**: Discoverability
- **Fix**: Extract the "Quick Start" and "Architecture Decisions" sections to README.md or a dedicated docs/development.md. Keep CLAUDE.md as AI-specific instructions.
- **Effort**: Small

#### M2. Source code lacks JSDoc comments on public APIs
- **Files**: All source files across packages
- **Issue**: Public functions and classes have minimal or no JSDoc. `attestation.ts` has good JSDoc on `verifyNitroAttestation()` but `tee-rex-prover.ts`, `encrypt.ts`, and server routes have none.
- **Category**: Code Documentation
- **Fix**: Add JSDoc to all exported functions, classes, and types.
- **Effort**: Medium

#### M3. No contribution guide
- **Issue**: No CONTRIBUTING.md. New contributors don't know about: conventional commits, Biome linting, test structure conventions, branch naming, PR process.
- **Category**: Onboarding
- **Fix**: Extract relevant sections from CLAUDE.md into CONTRIBUTING.md.
- **Effort**: Small

#### M4. No onboarding guide for local development setup
- **Issue**: CLAUDE.md has a "Quick Start" section, but it doesn't cover: prerequisites (Bun version, Node version), Aztec local network setup, env vars for remote/TEE testing, how to run specific test files.
- **Category**: Developer Experience
- **Fix**: Expand Quick Start or create docs/getting-started.md with step-by-step instructions.
- **Effort**: Small

#### M5. docs/ folder has useful content but no index
- **File**: `docs/` directory
- **Issue**: Contains `ci-pipeline.md`, `how-it-works.md`, `nitro-deployment.md` but no index or navigation. A developer browsing docs/ has to guess which file is relevant.
- **Category**: Navigation
- **Fix**: Add a docs/README.md that lists and describes each document.
- **Effort**: Trivial

### Low

#### L1. Lessons folder is historical (5 files)
- **File**: `lessons/`
- **Issue**: Contains debugging records from past phases. Useful for the AI (CLAUDE.md references them) but clutters the repo for human readers.
- **Category**: Organization
- **Fix**: Acceptable as-is. Could add a note in README.md that `lessons/` contains historical debugging notes.
- **Effort**: Trivial

#### L2. Error messages could be more actionable
- **Issue**: Some error messages are technical but not actionable. E.g., "Transaction dropped" (what should the user do?), "Wallet not initialized" (how to fix?).
- **Category**: UX
- **Fix**: Add suggestions: "Transaction dropped — try again or check network status".
- **Effort**: Small

#### L3. `plans/` folder has a single old file
- **File**: `plans/phase-4-testing-and-demo.md`
- **Issue**: Historical planning document. Not referenced anywhere.
- **Category**: Cleanup
- **Fix**: Move to `lessons/` or delete.
- **Effort**: Trivial

## Positive Notes

- CLAUDE.md is genuinely excellent as a living development document
- SDK README has installation, usage examples, and mode documentation
- docs/ci-pipeline.md is thorough with mermaid diagrams
- docs/how-it-works.md explains the attestation flow clearly
- docs/nitro-deployment.md is detailed enough for ops use
- Lesson files capture real debugging sessions (valuable institutional knowledge)
- Commit messages follow conventional commits consistently
