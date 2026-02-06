/**
 * Global test setup - runs once before all test files
 *
 * Starts services and registers cleanup handlers.
 */

import { expect } from "bun:test";
import { hasOwnedProcesses, startAllServices, stopAllServices } from "./services";

// Patch expect for @aztec/foundation compatibility
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Environment configuration
export const config = {
  nodeUrl: process.env.AZTEC_NODE_URL || "http://localhost:8080",
  teeRexUrl: process.env.TEEREX_URL || "http://localhost:4000",
  autoStart: process.env.INTEGRATION_AUTO_START !== "false",
};

// Service availability flags (shared across all test files)
export const services = {
  aztecNode: false,
  teeRexServer: false,
  servicesStarted: false,
  setupComplete: false,
};

/**
 * Check if the Aztec node is available
 */
async function checkAztecNode(): Promise<boolean> {
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
async function checkTeeRexServer(): Promise<boolean> {
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
 * Global setup - runs once before all tests
 */
async function globalSetup(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Integration Test Setup");
  console.log("═══════════════════════════════════════════════════════════");

  // Check if services are already running
  const [aztecNode, teeRexServer] = await Promise.all([checkAztecNode(), checkTeeRexServer()]);

  if (aztecNode && teeRexServer) {
    console.log("\n✅ All services already running\n");
    services.aztecNode = true;
    services.teeRexServer = true;
    services.setupComplete = true;
    return;
  }

  // Start services if auto-start is enabled
  if (config.autoStart) {
    console.log("\n📦 Services not running - starting automatically...");
    const started = await startAllServices();

    if (started) {
      services.aztecNode = true;
      services.teeRexServer = true;
      services.servicesStarted = true;
    } else {
      console.log("\n❌ Failed to start services - tests will FAIL");
      console.log("   Make sure 'aztec' CLI is installed:");
      console.log("   curl -fsSL https://install.aztec.network | bash\n");
      // Services remain false, tests will fail with clear assertions
    }
  } else {
    console.log("\n⚠️  Some services not available and auto-start is disabled");
    console.log("   Tests will FAIL without services.\n");
    services.aztecNode = aztecNode;
    services.teeRexServer = teeRexServer;
  }

  services.setupComplete = true;
}

/**
 * Global teardown - runs once after all tests
 */
async function globalTeardown(): Promise<void> {
  if (hasOwnedProcesses()) {
    await stopAllServices();
  }
}

// Register cleanup handlers
process.on("exit", () => {
  // Sync cleanup - can't use async here
  if (hasOwnedProcesses()) {
    console.log("\n🛑 Cleaning up services...");
  }
});

process.on("SIGINT", async () => {
  await globalTeardown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await globalTeardown();
  process.exit(0);
});

// Register afterAll at the global level for cleanup
import { afterAll } from "bun:test";

afterAll(async () => {
  await globalTeardown();
});

// Run setup immediately when this module is loaded (via preload)
await globalSetup();
