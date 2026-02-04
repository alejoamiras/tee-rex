/**
 * Service management for integration tests
 *
 * Automatically starts and stops Aztec sandbox and tee-rex server.
 */

import { spawn, type Subprocess } from "bun";

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
 * Start the Aztec sandbox
 */
export async function startAztecSandbox(): Promise<boolean> {
  console.log("\n🚀 Starting Aztec sandbox...");

  // Check if already running
  try {
    const response = await fetch("http://localhost:8080/status", {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      console.log("   ℹ️  Aztec sandbox already running");
      return true;
    }
  } catch {
    // Not running, we'll start it
  }

  try {
    services.aztecProcess = spawn({
      cmd: ["aztec", "start", "--sandbox"],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for sandbox to be ready
    const ready = await waitForService(
      "http://localhost:8080/status",
      "Aztec sandbox",
      180000, // 3 minutes for sandbox startup
    );

    if (!ready && services.aztecProcess) {
      services.aztecProcess.kill();
      services.aztecProcess = null;
    }

    return ready;
  } catch (error) {
    console.log(`   ❌ Failed to start Aztec sandbox: ${error}`);
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
 */
export async function startAllServices(): Promise<boolean> {
  const aztecReady = await startAztecSandbox();
  if (!aztecReady) {
    console.log("\n❌ Failed to start Aztec sandbox");
    console.log("   Make sure 'aztec' CLI is installed and in PATH");
    console.log("   Install with: curl -fsSL https://install.aztec.network | bash");
    return false;
  }

  const serverReady = await startTeeRexServer();
  if (!serverReady) {
    console.log("\n❌ Failed to start tee-rex server");
    return false;
  }

  console.log("\n✅ All services started successfully\n");
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

  if (services.aztecProcess) {
    console.log("   Stopping Aztec sandbox...");
    services.aztecProcess.kill();
    services.aztecProcess = null;
  }

  // Give processes time to clean up
  await Bun.sleep(1000);
  console.log("   ✅ Services stopped\n");
}

/**
 * Check if services were started by us (vs already running)
 */
export function hasOwnedProcesses(): boolean {
  return services.aztecProcess !== null || services.serverProcess !== null;
}
