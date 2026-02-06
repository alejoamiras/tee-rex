/**
 * Mode-switching integration tests
 *
 * Validates that switching between remote and local proving modes mid-session
 * works correctly. Deploys one account with remote proving, then another with
 * local proving, using the same TeeRexProver instance.
 *
 * Services are automatically started via globalSetup.ts preload.
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

describe("Mode Switching", () => {
  describe("Setup", () => {
    test("should create TeeRexProver starting in remote mode", () => {
      expect(services.aztecNode && services.teeRexServer).toBe(true);

      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      expect(prover).toBeDefined();
      console.log("   ✅ TeeRexProver created in remote mode");
    });

    test("should connect to Aztec node", async () => {
      expect(services.aztecNode && services.teeRexServer).toBe(true);

      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      console.log(`   ✅ Connected to Aztec node (chain: ${nodeInfo.l1ChainId})`);
    });

    test("should create TestWallet and register accounts", async () => {
      expect(services.aztecNode && services.teeRexServer).toBe(true);
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

      registeredAddresses = await registerInitialLocalNetworkAccountsInWallet(wallet);

      expect(wallet).toBeDefined();
      expect(registeredAddresses.length).toBeGreaterThan(0);
      console.log(`   ✅ Wallet ready with ${registeredAddresses.length} accounts`);
    });
  });

  describe("Remote → Local Transition", () => {
    test("should deploy first account with remote proving", async () => {
      expect(services.aztecNode && services.teeRexServer).toBe(true);
      expect(wallet).toBeDefined();

      console.log("   [Remote Mode] Creating Schnorr account...");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      console.log("   [Remote Mode] Deploying account...");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      console.log(`   ✅ Remote deploy: ${elapsed}s`);
    }, 600000);

    test("should switch to local mode and deploy second account", async () => {
      expect(services.aztecNode && services.teeRexServer).toBe(true);
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      console.log("   Switched to local proving mode");

      console.log("   [Local Mode] Creating Schnorr account...");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      console.log("   [Local Mode] Deploying account...");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      console.log(`   ✅ Local deploy: ${elapsed}s`);
    }, 600000);
  });
});
