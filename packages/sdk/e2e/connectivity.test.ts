/**
 * Connectivity tests — verify Aztec node, tee-rex server, and accelerator are reachable.
 *
 * Services must be running before tests start (asserted by e2e-setup.ts preload).
 * Accelerator health check requires ACCELERATOR_URL env var — skipped when not set.
 */

import { describe, expect, test } from "bun:test";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getLogger } from "@logtape/logtape";
import { config } from "./e2e-setup";

const logger = getLogger(["tee-rex", "sdk", "e2e", "connectivity"]);

describe("Service Connectivity", () => {
  describe("Aztec Node", () => {
    test("should return node info", async () => {
      const node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      logger.info("Got node info", { chainId: nodeInfo.l1ChainId });
    });
  });

  describe("Tee-Rex Server", () => {
    test("should return encryption public key", async () => {
      const response = await fetch(`${config.proverUrl}/encryption-public-key`);
      const data = await response.json();

      expect(data.publicKey).toBeDefined();
      expect(data.publicKey).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    });
  });

  describe.skipIf(!process.env.ACCELERATOR_URL)("Accelerator", () => {
    test("should return health status", async () => {
      const response = await fetch(`${process.env.ACCELERATOR_URL}/health`);
      const data = await response.json();

      expect(data.status).toBe("ok");
      logger.info("Accelerator healthy", data);
    });
  });
});
