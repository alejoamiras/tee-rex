/**
 * TeeRexProver proving e2e tests
 *
 * One shared setup (prover + wallet + Sponsored FPC), then deploys an account
 * in each mode:
 *   - UEE: standard tee-rex server
 *   - Local: WASM fallback
 *   - Accelerated: native accelerator with phase tracking (skipped when ACCELERATOR_URL not set)
 *   - Accelerated (fallback): dead port triggers WASM fallback (always runs)
 *   - TEE: real Nitro Enclave (skipped when TEE_URL is not set)
 *
 * Network-agnostic: always uses Sponsored FPC + from: AztecAddress.ZERO.
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 */

import { describe, expect, test } from "bun:test";
import { type ProverPhase, ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
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

const logger = getLogger(["tee-rex", "sdk", "e2e", "proving"]);

// Shared state across all describes
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: EmbeddedWallet;
let feePaymentMethod: SponsoredFeePaymentMethod;

describe("TeeRexProver", () => {
  describe("Setup", () => {
    test("should create prover and connect to Aztec node", async () => {
      prover = new TeeRexProver(config.proverUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.uee);

      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
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

      // Derive canonical Sponsored FPC address and register in PXE
      const fpcInstance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContract.artifact,
        { salt: new Fr(0) },
      );
      await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
      feePaymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);

      expect(wallet).toBeDefined();
      logger.info("Wallet ready with Sponsored FPC", {
        fpc: fpcInstance.address.toString().slice(0, 20),
      });
    });
  });

  describe("UEE", () => {
    test("should deploy account with UEE proving", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.uee);
      prover.setApiUrl(config.proverUrl);

      const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
      expect(deployed).toBeDefined();
    }, 600000);
  });

  describe("Local", () => {
    test("should deploy account with local proving", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);

      const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
      expect(deployed).toBeDefined();
    }, 600000);
  });

  describe.skipIf(!process.env.ACCELERATOR_URL)("Accelerated", () => {
    test("should deploy account with accelerated proving and track phases", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.accelerated);
      if (process.env.ACCELERATOR_URL) {
        const url = new URL(process.env.ACCELERATOR_URL);
        prover.setAcceleratorConfig({
          host: url.hostname,
          port: Number.parseInt(url.port, 10),
        });
      }

      const phases: ProverPhase[] = [];
      prover.setOnPhase((phase) => phases.push(phase));

      const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
      expect(deployed).toBeDefined();

      expect(phases).toContain("detect");
      expect(phases).toContain("serialize");
      expect(phases).not.toContain("fallback");
      logger.info("Accelerated phases", { phases });

      prover.setOnPhase(null);
    }, 600000);

    test.skipIf(!process.env.ACCELERATOR_DOWNLOAD_TEST)(
      "should download bb for a different version and prove",
      async () => {
        expect(wallet).toBeDefined();

        prover.setProvingMode(ProvingMode.accelerated);
        if (process.env.ACCELERATOR_URL) {
          const url = new URL(process.env.ACCELERATOR_URL);
          prover.setAcceleratorConfig({
            host: url.hostname,
            port: Number.parseInt(url.port, 10),
          });
        }

        const phases: ProverPhase[] = [];
        prover.setOnPhase((phase) => phases.push(phase));

        const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
        expect(deployed).toBeDefined();

        // The accelerator may emit "downloading" if the SDK version differs
        // from the bundled version. Either way, proving should succeed.
        expect(phases).toContain("detect");
        expect(phases).not.toContain("fallback");
        logger.info("Download test phases", { phases });

        prover.setOnPhase(null);
      },
      600000,
    );
  });

  describe("Accelerated (fallback)", () => {
    test("should fall back to WASM when accelerator is unreachable", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.accelerated);
      prover.setAcceleratorConfig({ port: 1 });

      const phases: ProverPhase[] = [];
      prover.setOnPhase((phase) => phases.push(phase));

      const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
      expect(deployed).toBeDefined();

      expect(phases).toContain("detect");
      expect(phases).toContain("fallback");
      expect(phases).not.toContain("serialize");
      logger.info("Fallback phases", { phases });

      prover.setAcceleratorConfig({ port: 59833 });
      prover.setOnPhase(null);
    }, 600000);
  });

  describe.skipIf(!config.teeUrl)("TEE", () => {
    test("should return nitro attestation from TEE server", async () => {
      const response = await fetch(`${config.teeUrl}/attestation`);
      const data = await response.json();

      expect(data.mode).toBe("nitro");
      expect(data.attestationDocument).toBeDefined();
      expect(data.publicKey).toContain("BEGIN PGP PUBLIC KEY BLOCK");
      logger.info("TEE attestation verified", { mode: data.mode });
    });

    test("should deploy account with TEE proving", async () => {
      expect(wallet).toBeDefined();

      prover.setApiUrl(config.teeUrl);
      prover.setProvingMode(ProvingMode.uee);

      const deployed = await deploySchnorrAccount(wallet, feePaymentMethod);
      expect(deployed).toBeDefined();
    }, 600000);
  });
});
