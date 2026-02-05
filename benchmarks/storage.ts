/**
 * Benchmark result storage and comparison utilities
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { BenchmarkResult, BenchmarkComparison, TimingResult } from "./types.js";
import { getMachineId } from "./machine.js";

const RESULTS_DIR = join(import.meta.dir, "results");

/**
 * Ensure results directory exists
 */
function ensureResultsDir(): void {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

/**
 * Generate a filename for benchmark results
 */
export function generateResultFilename(suiteName: string): string {
  const machineId = getMachineId();
  const date = new Date().toISOString().split("T")[0];
  const time = new Date().toISOString().split("T")[1]?.slice(0, 5).replace(":", "");
  const safeSuiteName = suiteName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${safeSuiteName}-${machineId}-${date}-${time}.json`;
}

/**
 * Save benchmark results to a JSON file
 */
export function saveResults(result: BenchmarkResult, filename?: string): string {
  ensureResultsDir();

  const fname = filename ?? generateResultFilename(result.suite);
  const filepath = join(RESULTS_DIR, fname);

  writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Results saved to: ${filepath}`);

  return filepath;
}

/**
 * Load benchmark results from a JSON file
 */
export function loadResults(filepath: string): BenchmarkResult {
  const fullPath = filepath.startsWith("/") ? filepath : join(RESULTS_DIR, filepath);
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as BenchmarkResult;
}

/**
 * Calculate if difference is statistically significant
 * Using coefficient of variation (CV) as a simple heuristic
 */
function isSignificant(
  baseline: TimingResult,
  comparison: TimingResult,
): boolean {
  const diffPercent = Math.abs(
    ((comparison.meanMs - baseline.meanMs) / baseline.meanMs) * 100,
  );
  // Consider significant if diff > 2x the coefficient of variation
  const baselineCV = (baseline.stdDevMs / baseline.meanMs) * 100;
  const comparisonCV = (comparison.stdDevMs / comparison.meanMs) * 100;
  const avgCV = (baselineCV + comparisonCV) / 2;
  return diffPercent > avgCV * 2;
}

/**
 * Compare two benchmark results
 */
export function compareResults(
  baselinePath: string,
  comparisonPath: string,
): BenchmarkComparison {
  const baseline = loadResults(baselinePath);
  const comparison = loadResults(comparisonPath);

  const comparisons: BenchmarkComparison["comparisons"] = [];

  for (const baseResult of baseline.results) {
    const compResult = comparison.results.find((r) => r.name === baseResult.name);
    if (!compResult) continue;

    const diffMs = compResult.meanMs - baseResult.meanMs;
    const diffPercent = (diffMs / baseResult.meanMs) * 100;

    comparisons.push({
      name: baseResult.name,
      baselineMeanMs: baseResult.meanMs,
      comparisonMeanMs: compResult.meanMs,
      diffMs: Math.round(diffMs * 100) / 100,
      diffPercent: Math.round(diffPercent * 10) / 10,
      faster: diffMs < 0,
      significant: isSignificant(baseResult, compResult),
    });
  }

  return {
    baseline: baselinePath,
    comparison: comparisonPath,
    comparisons,
  };
}

/**
 * Format comparison as a markdown table
 */
export function formatComparisonMarkdown(comparison: BenchmarkComparison): string {
  const lines: string[] = [
    "# Benchmark Comparison",
    "",
    `**Baseline:** \`${comparison.baseline}\``,
    `**Comparison:** \`${comparison.comparison}\``,
    "",
    "| Benchmark | Baseline | Comparison | Diff | Change | Significant |",
    "|-----------|----------|------------|------|--------|-------------|",
  ];

  for (const c of comparison.comparisons) {
    const icon = c.faster ? "🟢" : c.diffPercent > 10 ? "🔴" : "🟡";
    const sign = c.diffMs >= 0 ? "+" : "";
    const sig = c.significant ? "✓" : "";
    lines.push(
      `| ${c.name} | ${formatMs(c.baselineMeanMs)} | ${formatMs(c.comparisonMeanMs)} | ${sign}${formatMs(c.diffMs)} | ${icon} ${sign}${c.diffPercent.toFixed(1)}% | ${sig} |`,
    );
  }

  return lines.join("\n");
}

/**
 * Format milliseconds for display
 */
function formatMs(ms: number): string {
  if (Math.abs(ms) < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format a single result as a markdown report
 */
export function formatResultMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [
    `# ${result.suite}`,
    "",
    "## Machine Info",
    "",
    `| Property | Value |`,
    `|----------|-------|`,
    `| Hostname | ${result.machine.hostname} |`,
    `| Platform | ${result.machine.platform} ${result.machine.arch} |`,
    `| OS | ${result.machine.osRelease} |`,
    `| CPU | ${result.machine.cpuModel} |`,
    `| Cores | ${result.machine.cpuCores} @ ${result.machine.cpuSpeed}MHz |`,
    `| Memory | ${result.machine.totalMemoryGB}GB |`,
    `| Bun | ${result.machine.bunVersion} |`,
    `| Date | ${result.machine.timestamp} |`,
    "",
    "## Results",
    "",
    "| Benchmark | Mean | Std Dev | p50 | p95 | p99 | Iterations |",
    "|-----------|------|---------|-----|-----|-----|------------|",
  ];

  for (const r of result.results) {
    lines.push(
      `| ${r.name} | ${formatMs(r.meanMs)} | ±${formatMs(r.stdDevMs)} | ${formatMs(r.p50Ms)} | ${formatMs(r.p95Ms)} | ${formatMs(r.p99Ms)} | ${r.iterations} |`,
    );
  }

  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total Duration:** ${formatMs(result.totalDurationMs)}`);
  lines.push(`- **Memory Usage:** ${result.memoryUsageMB.toFixed(1)}MB`);
  lines.push(`- **Benchmark Version:** ${result.version}`);

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    lines.push("");
    for (const error of result.errors) {
      lines.push(`- ❌ ${error}`);
    }
  }

  return lines.join("\n");
}
