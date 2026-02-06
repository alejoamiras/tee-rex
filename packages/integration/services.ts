/**
 * Service management for integration tests
 *
 * Both services are auto-started if not already running:
 * - Aztec local network: `aztec start --local-network`
 * - Tee-rex server: `bun run src/index.ts`
 */

import { getLogger } from "@logtape/logtape";
import { type Subprocess, spawn } from "bun";

const logger = getLogger(["tee-rex", "integration", "services"]);

export interface ManagedServices {
  aztecProcess: Subprocess | null;
  serverProcess: Subprocess | null;
}

const services: ManagedServices = {
  aztecProcess: null,
  serverProcess: null,
};

/**
 * Wait for a service to be ready by polling an endpoint
 */
async function waitForService(
  url: string,
  name: string,
  timeoutMs = 120000,
  intervalMs = 2000,
): Promise<boolean> {
  const startTime = Date.now();
  logger.debug("Waiting for service", { name, url });

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        logger.info("Service ready", { name });
        return true;
      }
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(intervalMs);
  }

  logger.error("Service failed to start", { name, timeoutMs });
  return false;
}

/**
 * Check if the Aztec node is running
 */
export async function checkAztecNode(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:8080/status", {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Find the aztec CLI binary
 */
function findAztecBinary(): string | null {
  // Check PATH first
  try {
    const result = Bun.spawnSync({ cmd: ["which", "aztec"] });
    const path = result.stdout.toString().trim();
    if (path) return path;
  } catch {
    // Not in PATH
  }

  // Check common install locations
  const home = process.env.HOME || "";
  const candidates = [`${home}/.aztec/bin/aztec`, `${home}/.aztec/current/node_modules/.bin/aztec`];

  // Also check versioned installs
  try {
    const versionsDir = `${home}/.aztec/versions`;
    const entries = Array.from(new Bun.Glob("*/node_modules/.bin/aztec").scanSync(versionsDir));
    for (const entry of entries) {
      candidates.push(`${versionsDir}/${entry}`);
    }
  } catch {
    // No versions dir
  }

  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);
      // Check if file exists by checking size (throws if not found)
      if (file.size > 0) return candidate;
    } catch {
      // Not found
    }
  }

  return null;
}

/**
 * Start the Aztec local network
 */
export async function startAztecNetwork(): Promise<boolean> {
  logger.info("Starting Aztec local network");

  // Check if already running
  if (await checkAztecNode()) {
    logger.info("Aztec node already running");
    return true;
  }

  const aztecBin = findAztecBinary();
  if (!aztecBin) {
    logger.error(
      "Aztec CLI not found. Install with: curl -fsSL https://install.aztec.network | bash",
    );
    return false;
  }

  logger.debug("Using aztec binary", { path: aztecBin });

  try {
    services.aztecProcess = spawn({
      cmd: [aztecBin, "start", "--local-network"],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Aztec network takes a while to start — wait up to 2 minutes
    const ready = await waitForService(
      "http://localhost:8080/status",
      "Aztec local network",
      120000,
    );

    if (!ready && services.aztecProcess) {
      services.aztecProcess.kill();
      services.aztecProcess = null;
    }

    return ready;
  } catch (error) {
    logger.error("Failed to start Aztec local network", { error });
    return false;
  }
}

/**
 * Start the tee-rex server
 */
export async function startTeeRexServer(): Promise<boolean> {
  logger.info("Starting tee-rex server");

  // Check if already running
  try {
    const response = await fetch("http://localhost:4000/encryption-public-key", {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      logger.info("Tee-rex server already running");
      return true;
    }
  } catch {
    // Not running, we'll start it
  }

  try {
    services.serverProcess = spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: `${import.meta.dir}/../server`,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PORT: "4000",
      },
    });

    // Wait for server to be ready
    const ready = await waitForService(
      "http://localhost:4000/encryption-public-key",
      "Tee-rex server",
      30000,
    );

    if (!ready && services.serverProcess) {
      services.serverProcess.kill();
      services.serverProcess = null;
    }

    return ready;
  } catch (error) {
    logger.error("Failed to start tee-rex server", { error });
    return false;
  }
}

/**
 * Start all services needed for integration tests
 */
export async function startAllServices(): Promise<boolean> {
  // Start Aztec local network
  const aztecReady = await startAztecNetwork();
  if (!aztecReady) {
    return false;
  }

  // Start tee-rex server
  const serverReady = await startTeeRexServer();
  if (!serverReady) {
    return false;
  }

  logger.info("All services ready");
  return true;
}

/**
 * Stop all managed services
 */
export async function stopAllServices(): Promise<void> {
  logger.info("Stopping services");

  if (services.serverProcess) {
    logger.debug("Stopping tee-rex server");
    services.serverProcess.kill();
    services.serverProcess = null;
  }

  if (services.aztecProcess) {
    logger.debug("Stopping Aztec local network");
    services.aztecProcess.kill();
    services.aztecProcess = null;
  }

  // Give processes time to clean up
  await Bun.sleep(1000);
  logger.info("Services stopped");
}

/**
 * Check if services were started by us (vs already running)
 */
export function hasOwnedProcesses(): boolean {
  return services.serverProcess !== null || services.aztecProcess !== null;
}
