const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const AZTEC_STATUS_URL = `${AZTEC_NODE_URL}/status`;
const PROVER_URL = process.env.PROVER_URL;
const isLocalNetwork = AZTEC_NODE_URL.includes("localhost") || AZTEC_NODE_URL.includes("127.0.0.1");

async function isServiceHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function assertServicesAvailable(): Promise<void> {
  const aztec = await isServiceHealthy(AZTEC_STATUS_URL);
  if (!aztec) {
    const hint = isLocalNetwork
      ? "Start Aztec local network before running fullstack e2e tests.\n  aztec start --local-network"
      : `Aztec node at ${AZTEC_NODE_URL} is unreachable — it may be down.`;
    throw new Error(`Aztec node not available at ${AZTEC_NODE_URL}. ${hint}`);
  }

  if (PROVER_URL) {
    const teerex = await isServiceHealthy(`${PROVER_URL}/encryption-public-key`);
    if (!teerex) {
      throw new Error(
        `TEE-Rex server not available at ${PROVER_URL}. Start tee-rex server before running fullstack e2e tests.\n` +
          "  bun run start",
      );
    }
  }
}
