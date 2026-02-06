/**
 * Global test setup - runs once before all test files
 *
 * Starts services and registers cleanup handlers.
 * Configures LogTape for structured logging with LOG_LEVEL env var support.
 */

import { afterAll, expect } from "bun:test";
import { configure, getConsoleSink, getLogger, parseLogLevel } from "@logtape/logtape";
import { hasOwnedProcesses, startAllServices, stopAllServices } from "./services";

// Patch expect for @aztec/foundation compatibility
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Configure LogTape for integration tests
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

const logger = getLogger(["tee-rex", "integration"]);

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
  logger.info("Integration test setup starting");

  // Check if services are already running
  const [aztecNode, teeRexServer] = await Promise.all([checkAztecNode(), checkTeeRexServer()]);

  if (aztecNode && teeRexServer) {
    logger.info("All services already running");
    services.aztecNode = true;
    services.teeRexServer = true;
    services.setupComplete = true;
    return;
  }

  // Start services if auto-start is enabled
  if (config.autoStart) {
    logger.info("Services not running, starting automatically");
    const started = await startAllServices();

    if (started) {
      services.aztecNode = true;
      services.teeRexServer = true;
      services.servicesStarted = true;
    } else {
      logger.error("Failed to start services");
    }
  } else {
    logger.warn("Some services not available and auto-start is disabled");
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
  if (hasOwnedProcesses()) {
    logger.info("Cleaning up services");
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
afterAll(async () => {
  await globalTeardown();
});

// Run setup immediately when this module is loaded (via preload)
await globalSetup();
