/**
 * Nextnet connectivity smoke tests
 *
 * Validates that the Aztec nextnet node is reachable and healthy.
 * Auto-skipped when running against local sandbox (default).
 *
 * Run with: bun run test:e2e:nextnet
 */

import { describe, expect, test } from "bun:test";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getLogger } from "@logtape/logtape";
import { config, isLocalNetwork } from "./e2e-setup.js";

const logger = getLogger(["tee-rex", "sdk", "e2e", "nextnet"]);

describe.skipIf(isLocalNetwork)("Nextnet Connectivity", () => {
  test("should reach the Aztec node /status endpoint", async () => {
    const res = await fetch(`${config.nodeUrl}/status`, {
      signal: AbortSignal.timeout(10000),
    });
    expect(res.ok).toBe(true);
    logger.info("Node /status reachable", { url: config.nodeUrl });
  });

  test("should return non-sandbox chain ID", async () => {
    const node = createAztecNodeClient(config.nodeUrl);
    const nodeInfo = await node.getNodeInfo();

    expect(nodeInfo.l1ChainId).toBeDefined();
    expect(nodeInfo.l1ChainId).not.toBe(31337);
    logger.info("Chain ID verified", { chainId: nodeInfo.l1ChainId });
  });

  test("should return valid node info", async () => {
    const node = createAztecNodeClient(config.nodeUrl);
    const nodeInfo = await node.getNodeInfo();

    expect(nodeInfo.l1ChainId).toBeGreaterThan(0);
    expect(nodeInfo.nodeVersion).toBeDefined();
    logger.info("Node info valid", {
      chainId: nodeInfo.l1ChainId,
      nodeVersion: nodeInfo.nodeVersion,
    });
  });

  test.skipIf(!process.env.PROVER_URL)("should reach remote prover", async () => {
    const res = await fetch(`${config.proverUrl}/encryption-public-key`, {
      signal: AbortSignal.timeout(10000),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.publicKey).toBeDefined();
    logger.info("Remote prover reachable", { url: config.proverUrl });
  });
});
