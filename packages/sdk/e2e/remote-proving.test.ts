/**
 * Remote proving flow e2e tests
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

const logger = getLogger(["tee-rex", "sdk", "e2e", "remote-proving"]);

// Shared state across tests
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: TestWallet;
let registeredAddresses: any[];

describe("TeeRexProver Integration", () => {
  describe("Prover Creation", () => {
    test("should create TeeRexProver with remote mode", () => {
      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      expect(prover).toBeDefined();
      logger.info("TeeRexProver created with remote mode");
    });
  });

  describe("Aztec Node Connection", () => {
    test("should connect to Aztec node", async () => {
      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      logger.info("Connected to Aztec node", { chainId: nodeInfo.l1ChainId });
    });
  });

  describe("TestWallet Integration", () => {
    test("should create TestWallet with TeeRexProver", async () => {
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
      logger.info("TestWallet created with TeeRexProver backend");
    });

    test("should register sandbox accounts", async () => {
      expect(wallet).toBeDefined();

      registeredAddresses = await registerInitialLocalNetworkAccountsInWallet(wallet);

      expect(registeredAddresses).toBeDefined();
      expect(registeredAddresses.length).toBeGreaterThan(0);
      logger.info("Registered sandbox accounts", { count: registeredAddresses.length });
    });
  });

  describe("Remote Proving", () => {
    test("should deploy account with remote proving", async () => {
      expect(wallet).toBeDefined();
      expect(registeredAddresses).toBeDefined();

      logger.debug("Creating new Schnorr account");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      expect(accountManager).toBeDefined();
      logger.debug("Account created", { address: accountManager.address.toString() });

      logger.debug("Deploying account (remote proving)");

      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();

      logger.info("Account deployed", {
        contract: deployedContract.address?.toString(),
        durationSec: elapsed,
      });
    }, 600000);
  });
});
