/**
 * Proving performance benchmarks
 *
 * Measures:
 * - Remote proof generation time (SDK -> Server -> Proof)
 * - Encryption/decryption overhead
 *
 * Prerequisites:
 * - Aztec sandbox running: aztec start --sandbox
 * - Tee-rex server running: bun run dev (or will be auto-started)
 */

import { BenchmarkSuite } from "./runner.js";
import { saveResults, formatResultMarkdown } from "./storage.js";

// Configuration
const config = {
  nodeUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080",
  teeRexUrl: process.env.TEEREX_URL ?? "http://localhost:4000",
  iterations: parseInt(process.env.BENCHMARK_ITERATIONS ?? "3", 10),
};

// Lazy-loaded modules (to avoid loading before services are checked)
let createAztecNodeClient: typeof import("@aztec/aztec.js/node").createAztecNodeClient;
let TestWallet: typeof import("@aztec/test-wallet/server").TestWallet;
let registerInitialLocalNetworkAccountsInWallet: typeof import("@aztec/test-wallet/server").registerInitialLocalNetworkAccountsInWallet;
let WASMSimulator: typeof import("@aztec/simulator/client").WASMSimulator;
let Fr: typeof import("@aztec/aztec.js/fields").Fr;
let TeeRexProver: typeof import("@nemi-fi/tee-rex").TeeRexProver;
let ProvingMode: typeof import("@nemi-fi/tee-rex").ProvingMode;

async function loadModules(): Promise<void> {
  console.log("📦 Loading Aztec modules...");

  const aztecNode = await import("@aztec/aztec.js/node");
  createAztecNodeClient = aztecNode.createAztecNodeClient;

  const testWallet = await import("@aztec/test-wallet/server");
  TestWallet = testWallet.TestWallet;
  registerInitialLocalNetworkAccountsInWallet =
    testWallet.registerInitialLocalNetworkAccountsInWallet;

  const simulator = await import("@aztec/simulator/client");
  WASMSimulator = simulator.WASMSimulator;

  const fields = await import("@aztec/aztec.js/fields");
  Fr = fields.Fr;

  const teeRex = await import("@nemi-fi/tee-rex");
  TeeRexProver = teeRex.TeeRexProver;
  ProvingMode = teeRex.ProvingMode;

  console.log("   ✅ Modules loaded\n");
}

async function checkServices(): Promise<boolean> {
  console.log("🔍 Checking services...\n");

  // Check Aztec node
  try {
    const response = await fetch(`${config.nodeUrl}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Not OK");
    console.log("   ✅ Aztec node available");
  } catch {
    console.log("   ❌ Aztec node not available");
    console.log(`      Start with: aztec start --sandbox`);
    return false;
  }

  // Check tee-rex server
  try {
    const response = await fetch(`${config.teeRexUrl}/encryption-public-key`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Not OK");
    console.log("   ✅ Tee-rex server available");
  } catch {
    console.log("   ❌ Tee-rex server not available");
    console.log(`      Start with: bun run dev`);
    return false;
  }

  console.log("");
  return true;
}

async function runBenchmarks(): Promise<void> {
  const suite = new BenchmarkSuite("TeeRex Proving Performance");
  suite.setExpectedCount(2); // Number of benchmarks we'll run
  suite.start();

  // Setup: Create wallet with TeeRexProver
  console.log("\n🔧 Setting up test environment...");

  const node = createAztecNodeClient(config.nodeUrl);
  const prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
  prover.setProvingMode(ProvingMode.remote);

  const wallet = await TestWallet.create(
    node,
    {},
    {
      proverOrOptions: prover,
      loggers: {},
    },
  );

  const registeredAddresses =
    await registerInitialLocalNetworkAccountsInWallet(wallet);

  const senderAddress = registeredAddresses[0];
  if (!senderAddress) {
    throw new Error("No registered addresses available");
  }

  console.log(`   ✅ Wallet ready with ${registeredAddresses.length} accounts`);

  // Benchmark 1: Account deployment (includes remote proving)
  await suite.run(
    "Account Deployment (Remote Proving)",
    async () => {
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);
      const deployMethod = await accountManager.getDeployMethod();
      await deployMethod.send({
        from: senderAddress,
        skipClassPublication: true,
      });
    },
    { warmup: 0, iterations: config.iterations },
  );

  // Benchmark 2: Encryption public key fetch (baseline network latency)
  await suite.run(
    "Fetch Encryption Public Key",
    async () => {
      const response = await fetch(`${config.teeRexUrl}/encryption-public-key`);
      await response.json();
    },
    { warmup: 1, iterations: 10 },
  );

  // Get final results
  const result = suite.finish();

  // Save results
  saveResults(result);

  // Display markdown report
  console.log("\n" + formatResultMarkdown(result));
}

async function main(): Promise<void> {
  console.log("");
  console.log("═".repeat(60));
  console.log("  TeeRex Proving Benchmarks");
  console.log("═".repeat(60));
  console.log("");
  console.log(`  Node URL:    ${config.nodeUrl}`);
  console.log(`  TeeRex URL:  ${config.teeRexUrl}`);
  console.log(`  Iterations:  ${config.iterations}`);
  console.log("");

  // Check services
  const servicesOk = await checkServices();
  if (!servicesOk) {
    console.log("❌ Services not available. Aborting benchmarks.\n");
    process.exit(1);
  }

  // Load modules
  await loadModules();

  // Run benchmarks
  await runBenchmarks();

  console.log("");
  console.log("═".repeat(60));
  console.log("  Benchmarks complete!");
  console.log("═".repeat(60));
  console.log("");
}

main().catch((error) => {
  console.error("\n❌ Benchmark failed:", error);
  process.exit(1);
});
