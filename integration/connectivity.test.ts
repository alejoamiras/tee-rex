/**
 * Connectivity tests for integration test prerequisites
 *
 * These tests verify that required services are available.
 * Services are automatically started if not running.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  config,
  services,
  detectAndStartServices,
  cleanupServices,
} from "./setup";

// Start services before running tests
beforeAll(async () => {
  await detectAndStartServices();
});

// Clean up services after tests
afterAll(async () => {
  await cleanupServices();
});

describe("Service Connectivity", () => {
  describe("Aztec Node", () => {
    test("should be available", async () => {
      expect(services.aztecNode).toBe(true);
    });

    test("should return node info", async () => {
      if (!services.aztecNode) {
        console.log("   [skipped - Aztec node not available]");
        return;
      }

      const { createAztecNodeClient } = await import("@aztec/aztec.js/node");
      const node = createAztecNodeClient(config.nodeUrl);
      const nodeInfo = await node.getNodeInfo();

      expect(nodeInfo).toBeDefined();
      expect(nodeInfo.l1ChainId).toBeDefined();
      console.log(`   Chain ID: ${nodeInfo.l1ChainId}`);
    });
  });

  describe("Tee-Rex Server", () => {
    test("should be available", async () => {
      expect(services.teeRexServer).toBe(true);
    });

    test("should return encryption public key", async () => {
      if (!services.teeRexServer) {
        console.log("   [skipped - Tee-rex server not available]");
        return;
      }

      const response = await fetch(
        `${config.teeRexUrl}/encryption-public-key`,
      );
      const data = await response.json();

      expect(data.publicKey).toBeDefined();
      expect(data.publicKey).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    });
  });

  describe("Service Summary", () => {
    test("reports service availability", () => {
      console.log("\n📊 Service Status:");
      console.log(
        `   Aztec Node:     ${services.aztecNode ? "✅ Available" : "❌ Not available"}`,
      );
      console.log(
        `   Tee-Rex Server: ${services.teeRexServer ? "✅ Available" : "❌ Not available"}`,
      );
      console.log(
        `   Auto-started:   ${services.servicesStarted ? "Yes" : "No (already running)"}`,
      );

      if (services.aztecNode && services.teeRexServer) {
        console.log("\n   ✅ All services available - proving tests will run!\n");
      } else {
        console.log("\n   ❌ Some services missing - proving tests will fail\n");
      }

      expect(true).toBe(true);
    });
  });
});
