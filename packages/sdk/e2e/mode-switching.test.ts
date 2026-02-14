/**
 * Mode-switching e2e tests
 *
 * Validates that switching between proving modes mid-session works correctly.
 * Deploys accounts with remote, local, and TEE proving using the same
 * TeeRexProver instance.
 *
 * TEE transitions require TEE_URL env var — skipped when not set.
 *
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 */

import { describe, expect, test } from "bun:test";
import { ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { registerInitialLocalNetworkAccountsInWallet } from "@aztec/wallets/testing";
import { getLogger } from "@logtape/logtape";
import { config } from "./e2e-setup";

const logger = getLogger(["tee-rex", "sdk", "e2e", "mode-switching"]);

// Shared state across tests
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: EmbeddedWallet;
let registeredAddresses: any[];

describe("Mode Switching", () => {
  describe("Setup", () => {
    test("should create TeeRexProver starting in remote mode", () => {
      prover = new TeeRexProver(config.proverUrl, new WASMSimulator());
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

    test("should create EmbeddedWallet and register accounts", async () => {
      expect(node).toBeDefined();
      expect(prover).toBeDefined();

      wallet = await EmbeddedWallet.create(node, {
        ephemeral: true,
        pxeOptions: { proverOrOptions: prover },
      });

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

  describe.skipIf(!config.teeUrl)("TEE Mode Transitions", () => {
    test("should switch from local to TEE and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setApiUrl(config.teeUrl);
      prover.setProvingMode(ProvingMode.remote);
      logger.info("Switched to TEE mode", { teeUrl: config.teeUrl });

      logger.debug("Creating Schnorr account (TEE mode)");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      logger.debug("Deploying account (TEE mode)");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      logger.info("TEE deploy completed", { durationSec: elapsed });
    }, 600000);

    test("should switch from TEE to local and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      logger.info("Switched from TEE to local proving mode");

      logger.debug("Creating Schnorr account (local after TEE)");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      logger.debug("Deploying account (local after TEE)");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      logger.info("Local deploy after TEE completed", { durationSec: elapsed });
    }, 600000);

    test("should switch from local back to standard remote and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setApiUrl(config.proverUrl);
      prover.setProvingMode(ProvingMode.remote);
      logger.info("Switched from local back to standard remote", { apiUrl: config.proverUrl });

      logger.debug("Creating Schnorr account (standard remote after TEE)");
      const secret = Fr.random();
      const salt = Fr.random();
      const accountManager = await wallet.createSchnorrAccount(secret, salt);

      logger.debug("Deploying account (standard remote after TEE)");
      const startTime = Date.now();
      const deployMethod = await accountManager.getDeployMethod();
      const deployedContract = await deployMethod.send({
        from: registeredAddresses[0],
        skipClassPublication: true,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      expect(deployedContract).toBeDefined();
      logger.info("Standard remote deploy after TEE completed", { durationSec: elapsed });
    }, 600000);
  });
});
