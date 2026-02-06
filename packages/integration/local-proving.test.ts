/**
 * Local proving flow integration tests
 *
 * Same deployment flow as remote-proving.test.ts but using ProvingMode.local.
 * This validates the local fallback works end-to-end.
 *
 * Services are automatically started via globalSetup.ts preload.
 * Only requires the Aztec node (not the tee-rex server).
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { config, services } from "./globalSetup";

// Lazy-loaded modules
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

// Load modules before tests
beforeAll(async () => {
  if (!services.aztecNode) {
    console.log("\n❌ Aztec node not available - tests will fail\n");
    return;
  }

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

describe("TeeRexProver Local Proving", () => {
  describe("Setup", () => {
    test("should create TeeRexProver with local mode", () => {
      expect(services.aztecNode).toBe(true);

      // apiUrl is still required by the constructor but won't be used in local mode
      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.local);

      expect(prover).toBeDefined();
      console.log("   ✅ TeeRexProver created with local mode");
    });

    test("should connect to Aztec node", async () => {
      expect(services.aztecNode).toBe(true);

      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      console.log(`   ✅ Connected to Aztec node (chain: ${nodeInfo.l1ChainId})`);
    });
  });

  describe("TestWallet Integration", () => {
    test("should create TestWallet with TeeRexProver in local mode", async () => {
      expect(services.aztecNode).toBe(true);
      expect(node).toBeDefined();
      expect(prover).toBeDefined();

      wallet = await TestWallet.create(
        node,
        {},
        {
          proverOrOptions: prover,
          loggers: {},
        },
      );

      expect(wallet).toBeDefined();
      console.log("   ✅ TestWallet created with TeeRexProver (local mode)");
    });

    test("should register sandbox accounts", async () => {
      expect(services.aztecNode).toBe(true);
      expect(wallet).toBeDefined();

      registeredAddresses = await registerInitialLocalNetworkAccountsInWallet(wallet);

      expect(registeredAddresses).toBeDefined();
      expect(registeredAddresses.length).toBeGreaterThan(0);
      console.log(`   ✅ Registered ${registeredAddresses.length} sandbox accounts`);
    });
  });

  describe("Local Proving", () => {
    test("should deploy account with local proving", async () => {
      expect(services.aztecNode).toBe(true);
      expect(wallet).toBeDefined();
      expect(registeredAddresses).toBeDefined();

      console.log("   Creating new Schnorr account...");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      expect(accountManager).toBeDefined();
      console.log(`   Account address: ${accountManager.address.toString()}`);

      console.log("   Deploying account (triggers local proving)...");

      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();

      console.log("   ✅ Account deployed with local proving!");
      console.log(`   📜 Contract: ${deployedContract.address?.toString()}`);
      console.log(`   ⏱️  Time: ${elapsed}s`);
    }, 600000); // 10 minute timeout — local proving is slower
  });
});
