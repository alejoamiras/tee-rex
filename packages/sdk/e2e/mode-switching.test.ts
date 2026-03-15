/**
 * Mode-switching e2e tests
 *
 * Validates that switching between proving modes mid-session works correctly.
 * Deploys accounts with UEE, local, accelerated, and TEE proving using the
 * same TeeRexProver instance.
 *
 * Network-agnostic: always uses Sponsored FPC + from: AztecAddress.ZERO.
 * Accelerated transitions require ACCELERATOR_URL env var — skipped when not set.
 * TEE transitions require TEE_URL env var — skipped when not set.
 *
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 */

import { describe, expect, test } from "bun:test";
import { ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { WASMSimulator } from "@aztec/simulator/client";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getLogger } from "@logtape/logtape";
import { deploySchnorrAccount } from "./e2e-helpers.js";
import { config } from "./e2e-setup.js";

const logger = getLogger(["tee-rex", "sdk", "e2e", "mode-switching"]);

// Shared state across tests
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: EmbeddedWallet;
let feePaymentMethod: SponsoredFeePaymentMethod;

describe("Mode Switching", () => {
  describe("Setup", () => {
    test("should create TeeRexProver starting in UEE mode", () => {
      prover = new TeeRexProver(config.proverUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.uee);

      expect(prover).toBeDefined();
      logger.info("TeeRexProver created in UEE mode");
    });

    test("should connect to Aztec node", async () => {
      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      logger.info("Connected to Aztec node", { chainId: nodeInfo.l1ChainId });
    });

    test("should create EmbeddedWallet with Sponsored FPC", async () => {
      expect(node).toBeDefined();
      expect(prover).toBeDefined();

      wallet = await EmbeddedWallet.create(node, {
        ephemeral: true,
        // Always generate real proofs — dummy proofs hide real issues.
        pxeConfig: { proverEnabled: true },
        pxeOptions: { proverOrOptions: prover },
      });

      // Derive Sponsored FPC address and register in PXE.
      // Uses SPONSORED_FPC_SALT when set (private FPC on live networks),
      // defaults to salt=0 (canonical FPC for local sandbox).
      const saltHex = process.env.SPONSORED_FPC_SALT;
      const fpcSalt = saltHex ? Fr.fromHexString(saltHex) : new Fr(0);
      const fpcInstance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContract.artifact,
        { salt: fpcSalt },
      );
      await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
      feePaymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);

      expect(wallet).toBeDefined();
      logger.info("Wallet ready with Sponsored FPC", {
        fpc: fpcInstance.address.toString().slice(0, 20),
      });
    });
  });

  describe("UEE → Local Transition", () => {
    test("should deploy first account with UEE proving", async () => {
      expect(wallet).toBeDefined();
      await deploySchnorrAccount(wallet, feePaymentMethod, "UEE mode");
    }, 600000);

    test("should switch to local mode and deploy second account", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      logger.info("Switched to local proving mode");

      await deploySchnorrAccount(wallet, feePaymentMethod, "local mode");
    }, 600000);
  });

  describe.skipIf(!process.env.ACCELERATOR_URL)("Accelerated Mode Transitions", () => {
    test("should switch from UEE to accelerated and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.accelerated);
      if (process.env.ACCELERATOR_URL) {
        const url = new URL(process.env.ACCELERATOR_URL);
        prover.setAcceleratorConfig({
          host: url.hostname,
          port: Number.parseInt(url.port, 10),
        });
      }
      logger.info("Switched to accelerated mode", { url: process.env.ACCELERATOR_URL });

      await deploySchnorrAccount(wallet, feePaymentMethod, "accelerated mode");
    }, 600000);

    test("should switch from accelerated to local and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      logger.info("Switched from accelerated to local proving mode");

      await deploySchnorrAccount(wallet, feePaymentMethod, "local after accelerated");
    }, 600000);
  });

  describe.skipIf(!config.teeUrl)("TEE Mode Transitions", () => {
    test("should switch from local to TEE and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setApiUrl(config.teeUrl);
      prover.setProvingMode(ProvingMode.uee);
      logger.info("Switched to TEE mode", { teeUrl: config.teeUrl });

      await deploySchnorrAccount(wallet, feePaymentMethod, "TEE mode");
    }, 600000);

    test("should switch from TEE to local and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);
      logger.info("Switched from TEE to local proving mode");

      await deploySchnorrAccount(wallet, feePaymentMethod, "local after TEE");
    }, 600000);

    test("should switch from local back to standard UEE and deploy", async () => {
      expect(wallet).toBeDefined();

      prover.setApiUrl(config.proverUrl);
      prover.setProvingMode(ProvingMode.uee);
      logger.info("Switched from local back to standard UEE", { apiUrl: config.proverUrl });

      await deploySchnorrAccount(wallet, feePaymentMethod, "standard UEE after TEE");
    }, 600000);
  });
});
