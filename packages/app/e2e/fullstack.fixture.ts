const AZTEC_STATUS_URL = `${process.env.AZTEC_NODE_URL || "http://localhost:8080"}/status`;
const PROVER_URL = process.env.PROVER_URL || "http://localhost:4000";
const TEEREX_KEY_URL = `${PROVER_URL}/encryption-public-key`;

async function isServiceHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function assertServicesAvailable(): Promise<void> {
  const [aztec, teerex] = await Promise.all([
    isServiceHealthy(AZTEC_STATUS_URL),
    isServiceHealthy(TEEREX_KEY_URL),
  ]);
  if (!aztec || !teerex) {
    throw new Error(
      `Required services not available (aztec: ${aztec}, tee-rex: ${teerex}). ` +
        "Start Aztec local network and tee-rex server before running fullstack e2e tests.\n" +
        "  aztec start --local-network\n" +
        "  bun run start",
    );
  }
}
