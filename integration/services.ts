/**
 * Service management for integration tests
 *
 * - Aztec sandbox: Must be started manually (complex infrastructure)
 *   Run: aztec start --sandbox
 * - Tee-rex server: Auto-started by tests
 */

import { spawn, type Subprocess } from "bun";

export interface ManagedServices {
  serverProcess: Subprocess | null;
}

const services: ManagedServices = {
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
  console.log(`   Waiting for ${name} at ${url}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        console.log(`   ✅ ${name} is ready`);
        return true;
      }
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(intervalMs);
  }

  console.log(`   ❌ ${name} failed to start within ${timeoutMs / 1000}s`);
  return false;
}

/**
 * Check if the Aztec sandbox is running
 */
export async function checkAztecSandbox(): Promise<boolean> {
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
 * Start the tee-rex server
 */
export async function startTeeRexServer(): Promise<boolean> {
  console.log("\n🚀 Starting tee-rex server...");

  // Check if already running
  try {
    const response = await fetch("http://localhost:4000/encryption-public-key", {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      console.log("   ℹ️  Tee-rex server already running");
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
    console.log(`   ❌ Failed to start tee-rex server: ${error}`);
    return false;
  }
}

/**
 * Start all services needed for integration tests
 *
 * Note: Aztec sandbox must be started manually before running tests.
 * Run: aztec start --sandbox
 */
export async function startAllServices(): Promise<boolean> {
  // Check if Aztec sandbox is running (must be started manually)
  console.log("\n🔍 Checking Aztec sandbox...");
  const aztecReady = await checkAztecSandbox();
  if (!aztecReady) {
    console.log("   ❌ Aztec sandbox is NOT running");
    console.log("");
    console.log("   Please start it manually in another terminal:");
    console.log("   $ aztec start --sandbox");
    console.log("");
    console.log("   If you don't have aztec installed:");
    console.log("   $ curl -fsSL https://install.aztec.network | bash");
    console.log("");
    return false;
  }
  console.log("   ✅ Aztec sandbox is running");

  // Start tee-rex server (auto-started)
  const serverReady = await startTeeRexServer();
  if (!serverReady) {
    return false;
  }

  console.log("\n✅ All services ready\n");
  return true;
}

/**
 * Stop all managed services
 */
export async function stopAllServices(): Promise<void> {
  console.log("\n🛑 Stopping services...");

  if (services.serverProcess) {
    console.log("   Stopping tee-rex server...");
    services.serverProcess.kill();
    services.serverProcess = null;
  }

  // Give processes time to clean up
  await Bun.sleep(1000);
  console.log("   ✅ Services stopped\n");
}

/**
 * Check if services were started by us (vs already running)
 */
export function hasOwnedProcesses(): boolean {
  return services.serverProcess !== null;
}
