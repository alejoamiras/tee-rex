/**
 * E2E test setup — runs once before all test files via preload.
 *
 * Asserts that Aztec node and tee-rex server are reachable.
 * Throws immediately if services are unavailable (no skip, no auto-start).
 */

import { expect } from "bun:test";
import { configure, getConsoleSink, parseLogLevel } from "@logtape/logtape";

// Patch expect for @aztec/foundation compatibility
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Configure LogTape
const logLevel = parseLogLevel(process.env.LOG_LEVEL || "warning");

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    {
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: "warning",
    },
    {
      category: ["tee-rex"],
      sinks: ["console"],
      lowestLevel: logLevel,
    },
  ],
});

// Environment configuration
export const config = {
  nodeUrl: process.env.AZTEC_NODE_URL || "http://localhost:8080",
  teeRexUrl: process.env.TEEREX_URL || "http://localhost:4000",
  /** Optional TEE server URL — TEE tests are skipped when not set. */
  teeUrl: process.env.TEE_URL || "",
};

// Assert services are available — fail fast with a clear message
async function assertServicesAvailable(): Promise<void> {
  const [aztecOk, teeRexOk] = await Promise.all([
    fetch(`${config.nodeUrl}/status`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false),
    fetch(`${config.teeRexUrl}/encryption-public-key`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false),
  ]);

  if (!aztecOk || !teeRexOk) {
    throw new Error(
      `Required services not available (aztec: ${aztecOk}, tee-rex: ${teeRexOk}). ` +
        "Start Aztec local network and tee-rex server before running e2e tests.\n" +
        "  aztec start --local-network\n" +
        "  bun run start",
    );
  }
}

await assertServicesAvailable();
