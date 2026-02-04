# Phase 3: Performance Benchmarking Plan

> Status: **Not Started**
> Depends on: Phase 2 (Integration tests)

## Overview

Create a benchmarking system to:
- Measure proof generation time for different operations
- Compare performance across machines (local dev, cloud VMs, TEE)
- Store results in a structured format
- Track performance regressions over time

## Goals

1. Benchmark local vs remote proving
2. Measure server-side proof generation
3. Store results with machine metadata
4. Enable comparison between result sets
5. Generate human-readable reports

## Task List

### Phase 3.0: Research
- [ ] Research Bun benchmarking capabilities
- [ ] Evaluate benchmark libraries (tinybench, etc.)
- [ ] Define operations to benchmark
- [ ] Design result storage format (JSON schema)

### Phase 3.1: Infrastructure
- [ ] Create `/benchmarks` directory
- [ ] Create benchmark runner utility
- [ ] Create machine metadata collector
- [ ] Create result storage mechanism

### Phase 3.2: Core Benchmarks
- [ ] Benchmark: Local proof generation
- [ ] Benchmark: Remote proof generation (with network)
- [ ] Benchmark: Server-only proof generation
- [ ] Benchmark: Encryption/decryption overhead

### Phase 3.3: Result Storage
- [ ] Define JSON schema for results
- [ ] Implement result writer
- [ ] Add machine identification
- [ ] Create results directory

### Phase 3.4: Comparison Tools
- [ ] Create comparison utility
- [ ] Create markdown report generator
- [ ] (Optional) HTML visualization

### Phase 3.5: Commands
- [ ] Add `bun run benchmark`
- [ ] Add `bun run benchmark:compare`
- [ ] Document usage

## Result Schema (Draft)

```json
{
  "version": "1.0",
  "timestamp": "2026-02-04T12:00:00Z",
  "machine": {
    "id": "machine-uuid",
    "os": "darwin",
    "cpu": "Apple M2 Pro",
    "cores": 12,
    "memory_gb": 32
  },
  "benchmarks": [
    {
      "name": "local_proof_generation",
      "iterations": 10,
      "mean_ms": 1234,
      "min_ms": 1100,
      "max_ms": 1400,
      "std_dev_ms": 50
    }
  ]
}
```

## Verification

```bash
# Run benchmarks
bun run benchmark

# Compare two machines
bun run benchmark:compare results/m2-pro.json results/ec2-c7i.json
```
