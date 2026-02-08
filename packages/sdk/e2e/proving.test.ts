/**
 * TeeRexProver proving e2e tests
 *
 * One shared setup (prover + wallet), then deploys an account in each mode:
 *   - Remote: standard tee-rex server
 *   - Local: WASM fallback
 *   - TEE: real Nitro Enclave (skipped when TEE_URL is not set)
 *
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 */

import { describe, expect, test } from "bun:test";
import { ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import { registerInitialLocalNetworkAccountsInWallet, TestWallet } from "@aztec/test-wallet/server";
import { getLogger } from "@logtape/logtape";
import { config } from "./e2e-setup";

const logger = getLogger(["tee-rex", "sdk", "e2e", "proving"]);

// Shared state across all describes
let node: ReturnType<typeof createAztecNodeClient>;
let prover: TeeRexProver;
let wallet: TestWallet;
let registeredAddresses: any[];

describe("TeeRexProver", () => {
  describe("Setup", () => {
    test("should create prover and connect to Aztec node", async () => {
      prover = new TeeRexProver(config.teeRexUrl, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
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

  describe("Remote", () => {
    test("should deploy account with remote proving", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.remote);
      prover.setApiUrl(config.teeRexUrl);

      const deployed = await deploySchnorrAccount();
      expect(deployed).toBeDefined();
    }, 600000);
  });

  describe("Local", () => {
    test("should deploy account with local proving", async () => {
      expect(wallet).toBeDefined();

      prover.setProvingMode(ProvingMode.local);

      const deployed = await deploySchnorrAccount();
      expect(deployed).toBeDefined();
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
      prover.setProvingMode(ProvingMode.remote);

      const deployed = await deploySchnorrAccount();
      expect(deployed).toBeDefined();
    }, 600000);
  });
});

/** Deploy a new Schnorr account using the current prover mode. */
async function deploySchnorrAccount() {
  const secret = Fr.random();
  const salt = Fr.random();
  const accountManager = await wallet.createSchnorrAccount(secret, salt);

  logger.debug("Deploying account", { address: accountManager.address.toString() });

  const startTime = Date.now();
  const deployMethod = await accountManager.getDeployMethod();
  const deployedContract = await deployMethod.send({
    from: registeredAddresses[0],
    skipClassPublication: true,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info("Account deployed", {
    contract: deployedContract.address?.toString(),
    durationSec: elapsed,
  });

  return deployedContract;
}
