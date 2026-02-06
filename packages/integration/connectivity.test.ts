/**
 * Connectivity tests for integration test prerequisites
 *
 * Services are automatically started via globalSetup.ts preload.
 * Tests FAIL if services cannot be started - this is intentional to ensure
 * the integration environment is properly configured.
 */

import { describe, expect, test } from "bun:test";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getLogger } from "@logtape/logtape";
import { config, services } from "./globalSetup";

const logger = getLogger(["tee-rex", "integration", "connectivity"]);

describe("Service Connectivity", () => {
  describe("Aztec Node", () => {
    test("should be available", () => {
      expect(services.aztecNode).toBe(true);
      logger.info("Aztec node is available");
    });

    test("should return node info", async () => {
      expect(services.aztecNode).toBe(true);

      const node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      logger.info("Got node info", { chainId: nodeInfo.l1ChainId });
    });
  });

  describe("Tee-Rex Server", () => {
    test("should be available", () => {
      expect(services.teeRexServer).toBe(true);
      logger.info("Tee-rex server is available");
    });

    test("should return encryption public key", async () => {
      expect(services.teeRexServer).toBe(true);

      const response = await fetch(`${config.teeRexUrl}/encryption-public-key`);
      const data = await response.json();

      expect(data.publicKey).toBeDefined();
      expect(data.publicKey).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    });
  });

  describe("Service Summary", () => {
    test("all services must be available", () => {
      logger.info("Service status", {
        aztecNode: services.aztecNode,
        teeRexServer: services.teeRexServer,
        autoStarted: services.servicesStarted,
      });

      // Fail if any service is missing
      expect(services.aztecNode).toBe(true);
      expect(services.teeRexServer).toBe(true);
    });
  });
});
