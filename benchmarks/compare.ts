/**
 * Benchmark comparison CLI
 *
 * Usage:
 *   bun run benchmarks/compare.ts                           # Show help
 *   bun run benchmarks/compare.ts <result.json>             # View single result
 *   bun run benchmarks/compare.ts <baseline> <comparison>   # Compare two results
 */

import {
  compareResults,
  formatComparisonMarkdown,
  loadResults,
  formatResultMarkdown,
} from "./storage.js";

function showHelp(): void {
  console.log("");
  console.log("═".repeat(60));
  console.log("  Benchmark Comparison Tool");
  console.log("═".repeat(60));
  console.log("");
  console.log("Usage:");
  console.log("  bun run benchmark:compare <result.json>");
  console.log("  bun run benchmark:compare <baseline.json> <comparison.json>");
  console.log("");
  console.log("Examples:");
  console.log("  # View a single result:");
  console.log("  bun run benchmark:compare results/proving-macbook-8c-16gb-2024-01-01-1200.json");
  console.log("");
  console.log("  # Compare two results:");
  console.log("  bun run benchmark:compare \\");
  console.log("    results/proving-macbook-8c-16gb-2024-01-01-1200.json \\");
  console.log("    results/proving-cloud-4c-8gb-2024-01-02-1400.json");
  console.log("");
  console.log("Environment Variables:");
  console.log("  BENCHMARK_ITERATIONS  Number of iterations (default: 3)");
  console.log("");
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showHelp();
  process.exit(0);
}

if (args.length === 1) {
  // View single result
  try {
    const result = loadResults(args[0]!);
    console.log("");
    console.log(formatResultMarkdown(result));
    console.log("");
  } catch (error) {
    console.error(`\n❌ Error loading result: ${error}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (args.length === 2) {
  // Compare two results
  try {
    const comparison = compareResults(args[0]!, args[1]!);
    console.log("");
    console.log(formatComparisonMarkdown(comparison));

    // Summary
    const faster = comparison.comparisons.filter((c) => c.faster).length;
    const slower = comparison.comparisons.filter((c) => !c.faster).length;
    const significant = comparison.comparisons.filter((c) => c.significant).length;

    console.log("");
    console.log("## Summary");
    console.log("");
    console.log(`- 🟢 **Faster:** ${faster} benchmark(s)`);
    console.log(`- 🔴 **Slower:** ${slower} benchmark(s)`);
    console.log(`- ✓ **Statistically significant:** ${significant} benchmark(s)`);
    console.log("");
  } catch (error) {
    console.error(`\n❌ Error comparing results: ${error}\n`);
    process.exit(1);
  }
  process.exit(0);
}

console.error("\n❌ Error: Expected 1 or 2 arguments\n");
showHelp();
process.exit(1);
