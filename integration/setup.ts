/**
 * Integration test setup utilities
 *
 * Provides service detection, automatic startup, and shared configuration.
 */

import { expect } from "bun:test";
import {
  startAllServices,
  stopAllServices,
  hasOwnedProcesses,
} from "./services";

// Patch expect for @aztec/foundation compatibility
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Environment configuration
export const config = {
  nodeUrl: process.env.AZTEC_NODE_URL || "http://localhost:8080",
  teeRexUrl: process.env.TEEREX_URL || "http://localhost:4000",
  // Skip auto-start if explicitly disabled
  autoStart: process.env.INTEGRATION_AUTO_START !== "false",
};

// Service availability flags
export const services = {
  aztecNode: false,
  teeRexServer: false,
  servicesStarted: false,
};

/**
 * Check if the Aztec node is available
 */
export async function checkAztecNode(): Promise<boolean> {
  try {
    const response = await fetch(`${config.nodeUrl}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the tee-rex server is available
 */
export async function checkTeeRexServer(): Promise<boolean> {
  try {
    const response = await fetch(`${config.teeRexUrl}/encryption-public-key`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return !!data.publicKey;
  } catch {
    return false;
  }
}

/**
 * Detect available services and optionally start them
 */
export async function detectAndStartServices(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Integration Test Setup");
  console.log("═══════════════════════════════════════════════════════════");

  // First check if services are already running
  const [aztecNode, teeRexServer] = await Promise.all([
    checkAztecNode(),
    checkTeeRexServer(),
  ]);

  if (aztecNode && teeRexServer) {
    console.log("\n✅ All services already running\n");
    services.aztecNode = true;
    services.teeRexServer = true;
    return;
  }

  // If auto-start is enabled and services aren't running, start them
  if (config.autoStart) {
    console.log("\n📦 Services not running - starting automatically...");
    const started = await startAllServices();

    if (started) {
      services.aztecNode = true;
      services.teeRexServer = true;
      services.servicesStarted = true;
    }
  } else {
    console.log("\n⚠️  Some services not available and auto-start is disabled");
    services.aztecNode = aztecNode;
    services.teeRexServer = teeRexServer;

    if (!aztecNode) {
      console.log(`   Aztec node not running at ${config.nodeUrl}`);
    }
    if (!teeRexServer) {
      console.log(`   Tee-rex server not running at ${config.teeRexUrl}`);
    }
  }
}

/**
 * Clean up services if we started them
 */
export async function cleanupServices(): Promise<void> {
  if (hasOwnedProcesses()) {
    await stopAllServices();
  }
}

/**
 * Check if all services required for full integration tests are available
 */
export function allServicesAvailable(): boolean {
  return services.aztecNode && services.teeRexServer;
}

// Register cleanup handler
process.on("SIGINT", async () => {
  await cleanupServices();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanupServices();
  process.exit(0);
});
