/**
 * Benchmark runner utilities
 *
 * Provides statistical analysis including:
 * - Mean, standard deviation
 * - Percentiles (p50, p95, p99)
 * - Memory tracking
 */

import type { TimingResult, BenchmarkResult } from "./types.js";
import { getMachineInfo } from "./machine.js";

const BENCHMARK_VERSION = "1.0.0";

export interface BenchmarkOptions {
  /** Number of warmup iterations (not counted) */
  warmup?: number;
  /** Number of measured iterations */
  iterations?: number;
  /** Setup function run before each iteration */
  setup?: () => Promise<void> | void;
  /** Teardown function run after each iteration */
  teardown?: () => Promise<void> | void;
}

const defaultOptions: Required<Omit<BenchmarkOptions, "setup" | "teardown">> = {
  warmup: 1,
  iterations: 5,
};

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

/**
 * Round to 2 decimal places
 */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Run a single benchmark with statistical analysis
 */
export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  options: BenchmarkOptions = {},
): Promise<TimingResult> {
  const opts = { ...defaultOptions, ...options };
  const samples: number[] = [];

  // Warmup phase (not measured)
  for (let i = 0; i < opts.warmup; i++) {
    if (options.setup) await options.setup();
    await fn();
    if (options.teardown) await options.teardown();
  }

  // Measured iterations
  for (let i = 0; i < opts.iterations; i++) {
    if (options.setup) await options.setup();

    const start = performance.now();
    await fn();
    const end = performance.now();

    samples.push(end - start);

    if (options.teardown) await options.teardown();
  }

  // Calculate statistics
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / samples.length;
  const variance =
    samples.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / samples.length;
  const stdDev = Math.sqrt(variance);

  return {
    name,
    totalDurationMs: round(sum),
    iterations: opts.iterations,
    meanMs: round(mean),
    stdDevMs: round(stdDev),
    minMs: round(sorted[0] ?? 0),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    samples: samples.map(round),
  };
}

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return round(usage.heapUsed / 1024 / 1024);
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Benchmark suite runner with progress tracking
 */
export class BenchmarkSuite {
  private name: string;
  private results: TimingResult[] = [];
  private errors: string[] = [];
  private startTime: number = 0;
  private benchmarkCount: number = 0;
  private completedCount: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Set expected number of benchmarks for progress tracking
   */
  setExpectedCount(count: number): void {
    this.benchmarkCount = count;
  }

  /**
   * Run a benchmark and add to results
   */
  async run(
    benchmarkName: string,
    fn: () => Promise<void> | void,
    options: BenchmarkOptions = {},
  ): Promise<TimingResult | null> {
    this.completedCount++;
    const progress =
      this.benchmarkCount > 0
        ? ` [${this.completedCount}/${this.benchmarkCount}]`
        : "";

    console.log(`\n  ⏱️  ${benchmarkName}${progress}`);
    console.log(`     Running ${options.iterations ?? defaultOptions.iterations} iterations...`);

    try {
      const result = await benchmark(benchmarkName, fn, options);
      this.results.push(result);

      console.log(`     ✅ ${formatDuration(result.meanMs)} (±${result.stdDevMs.toFixed(1)}ms)`);
      console.log(
        `        p50: ${formatDuration(result.p50Ms)} | p95: ${formatDuration(result.p95Ms)} | p99: ${formatDuration(result.p99Ms)}`,
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.errors.push(`${benchmarkName}: ${errorMsg}`);
      console.log(`     ❌ Error: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Start timing the suite
   */
  start(): void {
    this.startTime = performance.now();
    console.log(`\n${"═".repeat(60)}`);
    console.log(`📊 ${this.name}`);
    console.log(`${"═".repeat(60)}`);
  }

  /**
   * Get the final benchmark result
   */
  finish(): BenchmarkResult {
    const totalDurationMs = performance.now() - this.startTime;
    const memoryUsageMB = getMemoryUsageMB();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`✅ Suite complete in ${formatDuration(totalDurationMs)}`);
    console.log(`   Memory usage: ${memoryUsageMB.toFixed(1)}MB`);
    if (this.errors.length > 0) {
      console.log(`   ⚠️  ${this.errors.length} error(s) encountered`);
    }

    return {
      suite: this.name,
      version: BENCHMARK_VERSION,
      machine: getMachineInfo(),
      results: this.results,
      totalDurationMs: round(totalDurationMs),
      memoryUsageMB,
      errors: this.errors,
    };
  }
}
