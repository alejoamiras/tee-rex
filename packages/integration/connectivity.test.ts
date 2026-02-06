/**
 * Connectivity tests for integration test prerequisites
 *
 * Services are automatically started via globalSetup.ts preload.
 * Tests FAIL if services cannot be started - this is intentional to ensure
 * the integration environment is properly configured.
 */

import { describe, expect, test } from "bun:test";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { config, services } from "./globalSetup";

describe("Service Connectivity", () => {
  describe("Aztec Node", () => {
    test("should be available", () => {
      expect(services.aztecNode).toBe(true);
      console.log("   ✅ Aztec node is available");
    });

    test("should return node info", async () => {
      expect(services.aztecNode).toBe(true);

      const node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      console.log(`   Chain ID: ${nodeInfo.l1ChainId}`);
    });
  });

  describe("Tee-Rex Server", () => {
    test("should be available", () => {
      expect(services.teeRexServer).toBe(true);
      console.log("   ✅ Tee-rex server is available");
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
      console.log("\n📊 Service Status:");
      console.log(`   Aztec Node:     ${services.aztecNode ? "✅ Available" : "❌ Not available"}`);
      console.log(
        `   Tee-Rex Server: ${services.teeRexServer ? "✅ Available" : "❌ Not available"}`,
      );
      console.log(`   Auto-started:   ${services.servicesStarted ? "Yes" : "No"}`);

      // Fail if any service is missing
      expect(services.aztecNode).toBe(true);
      expect(services.teeRexServer).toBe(true);

      console.log("\n   ✅ All services available\n");
    });
  });
});
