/**
 * Mode-switching e2e tests
 *
 * Validates that switching between remote and local proving modes mid-session
 * works correctly. Deploys one account with remote proving, then another with
 * local proving, using the same TeeRexProver instance.
 *
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 */

import { describe, expect, test } from "bun:test";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import { registerInitialLocalNetworkAccountsInWallet, TestWallet } from "@aztec/test-wallet/server";
import { getLogger } from "@logtape/logtape";
import { ProvingMode, TeeRexProver } from "@nemi-fi/tee-rex";
import { config } from "./e2e-setup";

const logger = getLogger(["tee-rex", "sdk", "e2e", "mode-switching"]);

// Shared state across tests
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: TestWallet;
let registeredAddresses: any[];

describe("Mode Switching", () => {
  describe("Setup", () => {
    test("should create TeeRexProver starting in remote mode", () => {
      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      expect(prover).toBeDefined();
      logger.info("TeeRexProver created in remote mode");
    });

    test("should connect to Aztec node", async () => {
      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      logger.info("Connected to Aztec node", { chainId: nodeInfo.l1ChainId });
    });

    test("should create TestWallet and register accounts", async () => {
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
      logger.info("Wallet ready", { accounts: registeredAddresses.length });
    });
  });

  describe("Remote → Local Transition", () => {
    test("should deploy first account with remote proving", async () => {
      expect(wallet).toBeDefined();

      logger.debug("Creating Schnorr account (remote mode)");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      logger.debug("Deploying account (remote mode)");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      logger.info("Remote deploy completed", { durationSec: elapsed });
    }, 600000);

    test("should switch to local mode and deploy second account", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      logger.info("Switched to local proving mode");

      logger.debug("Creating Schnorr account (local mode)");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      logger.debug("Deploying account (local mode)");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      logger.info("Local deploy completed", { durationSec: elapsed });
    }, 600000);
  });
});
