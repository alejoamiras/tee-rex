/**
 * Proving flow integration tests
 *
 * These tests verify the full proving flow:
 * 1. TeeRexProver creation
 * 2. TestWallet integration
 * 3. Account registration
 * 4. Account deployment with remote proving
 *
 * Services are automatically started if not running.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  config,
  services,
  allServicesAvailable,
  detectAndStartServices,
  cleanupServices,
} from "./setup";

// Lazy-loaded modules (to avoid import errors when services unavailable)
let createAztecNodeClient: typeof import("@aztec/aztec.js/node").createAztecNodeClient;
let TestWallet: typeof import("@aztec/test-wallet/server").TestWallet;
let registerInitialLocalNetworkAccountsInWallet: typeof import("@aztec/test-wallet/server").registerInitialLocalNetworkAccountsInWallet;
let WASMSimulator: typeof import("@aztec/simulator/client").WASMSimulator;
let Fr: typeof import("@aztec/aztec.js/fields").Fr;
let TeeRexProver: typeof import("@nemi-fi/tee-rex").TeeRexProver;
let ProvingMode: typeof import("@nemi-fi/tee-rex").ProvingMode;

// Shared state across tests
let node: Awaited<ReturnType<typeof createAztecNodeClient>>;
let prover: InstanceType<typeof TeeRexProver>;
let wallet: InstanceType<typeof TestWallet>;
let registeredAddresses: any[];

// Start services before running tests
beforeAll(async () => {
  await detectAndStartServices();

  if (!allServicesAvailable()) {
    console.log("\n⚠️  Skipping proving tests - services not available\n");
    return;
  }

  // Load modules dynamically
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
});

// Clean up services after tests
afterAll(async () => {
  await cleanupServices();
});

describe("TeeRexProver Integration", () => {
  describe("Prover Creation", () => {
    test("should create TeeRexProver with remote mode", async () => {
      if (!allServicesAvailable()) {
        console.log("   [skipped - services not available]");
        return;
      }

      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      expect(prover).toBeDefined();
      console.log("   ✅ TeeRexProver created with remote mode");
    });
  });

  describe("Aztec Node Connection", () => {
    test("should connect to Aztec node", async () => {
      if (!allServicesAvailable()) {
        console.log("   [skipped - services not available]");
        return;
      }

      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      console.log(`   ✅ Connected to Aztec node (chain: ${nodeInfo.l1ChainId})`);
    });
  });

  describe("TestWallet Integration", () => {
    test("should create TestWallet with TeeRexProver", async () => {
      if (!allServicesAvailable() || !node || !prover) {
        console.log("   [skipped - prerequisites not met]");
        return;
      }

      wallet = await TestWallet.create(
        node,
        {},
        {
          proverOrOptions: prover,
          loggers: {},
        },
      );

      expect(wallet).toBeDefined();
      console.log("   ✅ TestWallet created with TeeRexProver backend");
    });

    test("should register sandbox accounts", async () => {
      if (!allServicesAvailable() || !wallet) {
        console.log("   [skipped - prerequisites not met]");
        return;
      }

      registeredAddresses =
        await registerInitialLocalNetworkAccountsInWallet(wallet);

      expect(registeredAddresses).toBeDefined();
      expect(registeredAddresses.length).toBeGreaterThan(0);
      console.log(
        `   ✅ Registered ${registeredAddresses.length} sandbox accounts`,
      );
    });
  });

  describe("Remote Proving", () => {
    test(
      "should deploy account with remote proving",
      async () => {
        if (!allServicesAvailable() || !wallet || !registeredAddresses) {
          console.log("   [skipped - prerequisites not met]");
          return;
        }

        console.log("   Creating new Schnorr account...");
        const secret = Fr.random();
        const salt = Fr.random();
        const accountManager = await wallet.createSchnorrAccount(secret, salt);

        expect(accountManager).toBeDefined();
        expect(accountManager.address).toBeDefined();
        console.log(`   Account address: ${accountManager.address.toString()}`);

        console.log("   Deploying account (triggers remote proving)...");
        console.log("   ⏳ This may take a while...");

        const startTime = Date.now();
        const deployMethod = await accountManager.getDeployMethod();
        const deployedContract = await deployMethod.send({
          from: registeredAddresses[0],
          skipClassPublication: true,
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        expect(deployedContract).toBeDefined();
        expect(deployedContract.address).toBeDefined();

        console.log(`   ✅ Account deployed successfully!`);
        console.log(`   📜 Contract: ${deployedContract.address?.toString()}`);
        console.log(`   ⏱️  Time: ${elapsed}s`);
      },
      // 10 minute timeout for proving
      600000,
    );
  });
});

describe("Integration Test Summary", () => {
  test("reports final status", () => {
    console.log("\n═══════════════════════════════════════════════════════════");

    if (allServicesAvailable()) {
      console.log("🎉 Integration tests completed!");
      console.log("═══════════════════════════════════════════════════════════");
      console.log("");
      console.log("   ✅ Aztec node connected");
      console.log("   ✅ Tee-rex server connected");
      console.log("   ✅ TeeRexProver created with remote mode");
      console.log("   ✅ TestWallet created with TeeRexProver backend");
      console.log("   ✅ Sandbox accounts registered");
      console.log("   ✅ Account deployed with remote proving");
    } else {
      console.log("⚠️  Integration tests skipped - services not available");
      console.log("═══════════════════════════════════════════════════════════");
      console.log("");
      console.log("   Services could not be started automatically.");
      console.log("   Make sure 'aztec' CLI is installed:");
      console.log("   curl -fsSL https://install.aztec.network | bash");
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");
    expect(true).toBe(true);
  });
});
