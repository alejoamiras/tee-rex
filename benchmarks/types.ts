/**
 * Benchmark result types
 */

import type { MachineInfo } from "./machine.js";

export interface TimingResult {
  /** Operation name */
  name: string;
  /** Total duration across all iterations in milliseconds */
  totalDurationMs: number;
  /** Number of iterations */
  iterations: number;
  /** Mean duration per iteration */
  meanMs: number;
  /** Standard deviation */
  stdDevMs: number;
  /** Min duration */
  minMs: number;
  /** Max duration */
  maxMs: number;
  /** Median (p50) */
  p50Ms: number;
  /** 95th percentile */
  p95Ms: number;
  /** 99th percentile */
  p99Ms: number;
  /** Individual measurements for analysis */
  samples: number[];
}

export interface BenchmarkResult {
  /** Benchmark suite name */
  suite: string;
  /** Version of the benchmark format */
  version: string;
  /** Machine info */
  machine: MachineInfo;
  /** Individual timing results */
  results: TimingResult[];
  /** Total benchmark duration */
  totalDurationMs: number;
  /** Memory usage at end of benchmark */
  memoryUsageMB: number;
  /** Any errors encountered */
  errors: string[];
}

export interface BenchmarkComparison {
  /** Baseline result file */
  baseline: string;
  /** Comparison result file */
  comparison: string;
  /** Comparison results */
  comparisons: {
    name: string;
    baselineMeanMs: number;
    comparisonMeanMs: number;
    diffMs: number;
    diffPercent: number;
    faster: boolean;
    /** Statistical significance indicator */
    significant: boolean;
  }[];
}
