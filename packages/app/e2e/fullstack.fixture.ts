const AZTEC_STATUS_URL = `${process.env.AZTEC_NODE_URL || "http://localhost:8080"}/status`;
const PROVER_URL = process.env.PROVER_URL;

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
    throw new Error(
      "Aztec node not available. Start Aztec local network before running fullstack e2e tests.\n" +
        "  aztec start --local-network",
    );
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
