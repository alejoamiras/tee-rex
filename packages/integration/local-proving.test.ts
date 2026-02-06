/**
 * Local proving flow integration tests
 *
 * Same deployment flow as remote-proving.test.ts but using ProvingMode.local.
 * This validates the local fallback works end-to-end.
 *
 * Services are automatically started via globalSetup.ts preload.
 * Only requires the Aztec node (not the tee-rex server).
 */

import { describe, expect, test } from "bun:test";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import { registerInitialLocalNetworkAccountsInWallet, TestWallet } from "@aztec/test-wallet/server";
import { ProvingMode, TeeRexProver } from "@nemi-fi/tee-rex";
import { config, services } from "./globalSetup";

// Shared state across tests
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: TestWallet;
let registeredAddresses: any[];

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
