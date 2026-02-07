import type { AztecAddress } from "@aztec/aztec.js";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import {
  registerInitialLocalNetworkAccountsInWallet,
  TestWallet,
} from "@aztec/test-wallet/client/lazy";
import { type ProvingMode, TeeRexProver } from "@nemi-fi/tee-rex";

export type LogFn = (msg: string, level?: "info" | "warn" | "error" | "success") => void;

export type UiMode = "local" | "remote" | "tee";

const AZTEC_NODE_URL = "/aztec"; // Proxied via Vite dev server
const LOCAL_TEEREX_URL = "http://localhost:4000";

export interface AztecState {
  node: ReturnType<typeof createAztecNodeClient> | null;
  prover: TeeRexProver | null;
  wallet: TestWallet | null;
  registeredAddresses: AztecAddress[];
  provingMode: ProvingMode;
  uiMode: UiMode;
  teeServerUrl: string;
}

export const state: AztecState = {
  node: null,
  prover: null,
  wallet: null,
  registeredAddresses: [],
  provingMode: "remote",
  uiMode: "remote",
  teeServerUrl: "",
};

export async function checkAztecNode(): Promise<boolean> {
  try {
    const res = await fetch(`${AZTEC_NODE_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkTeeRexServer(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_TEEREX_URL}/encryption-public-key`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.publicKey;
  } catch {
    return false;
  }
}

export async function initializeWallet(log: LogFn): Promise<boolean> {
  try {
    log("Creating TeeRexProver...");
    state.prover = new TeeRexProver(LOCAL_TEEREX_URL, new WASMSimulator());
    state.prover.setProvingMode(state.provingMode);

    log("Connecting to Aztec node...");
    state.node = createAztecNodeClient(AZTEC_NODE_URL);
    const [nodeInfo, l1Contracts] = await Promise.all([
      state.node.getNodeInfo(),
      state.node.getL1ContractAddresses(),
    ]);
    log(`Connected — chain ${nodeInfo.l1ChainId}`, "success");

    log("Creating wallet (may take a moment)...");
    // Pre-fetch l1Contracts and pass them in config to avoid extra async
    // operations during PXE init (prevents IndexedDB transaction timeouts).
    // Pattern from gregoswap's EmbeddedWallet.
    state.wallet = await TestWallet.create(
      state.node,
      {
        dataDirectory: `tee-rex-demo-${l1Contracts.rollupAddress}`,
        l1Contracts,
      },
      {
        proverOrOptions: state.prover,
        loggers: {},
      },
    );
    log("Wallet created", "success");

    log("Registering sandbox accounts...");
    state.registeredAddresses = await registerInitialLocalNetworkAccountsInWallet(state.wallet);
    log(`Registered ${state.registeredAddresses.length} accounts`, "success");

    return true;
  } catch (err) {
    log(`Wallet initialization failed: ${err}`, "error");
    return false;
  }
}

export function setUiMode(mode: UiMode, teeUrl?: string): void {
  state.uiMode = mode;
  if (!state.prover) return;

  switch (mode) {
    case "local":
      state.provingMode = "local";
      state.prover.setProvingMode("local");
      state.prover.setApiUrl(LOCAL_TEEREX_URL);
      state.prover.setAttestationConfig({});
      break;
    case "remote":
      state.provingMode = "remote";
      state.prover.setProvingMode("remote");
      state.prover.setApiUrl(LOCAL_TEEREX_URL);
      state.prover.setAttestationConfig({});
      break;
    case "tee":
      if (teeUrl) state.teeServerUrl = teeUrl;
      state.provingMode = "remote";
      state.prover.setProvingMode("remote");
      state.prover.setApiUrl(state.teeServerUrl);
      state.prover.setAttestationConfig({ requireAttestation: true });
      break;
  }
}

export async function checkTeeAttestation(
  url: string,
): Promise<{ reachable: boolean; mode: "nitro" | "standard" | null }> {
  try {
    const res = await fetch(`${url}/attestation`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { reachable: false, mode: null };
    const data = await res.json();
    return { reachable: true, mode: data.mode ?? null };
  } catch {
    return { reachable: false, mode: null };
  }
}

export interface DeployResult {
  address: string;
  durationMs: number;
  mode: UiMode;
}

export async function deployTestAccount(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
): Promise<DeployResult> {
  if (!state.wallet || !state.registeredAddresses.length) {
    throw new Error("Wallet not initialized");
  }

  const mode = state.uiMode;
  log(`Creating Schnorr account [${mode}]...`);

  const secret = Fr.random();
  const salt = Fr.random();
  const accountManager = await state.wallet.createSchnorrAccount(secret, salt);
  log(`Account: ${accountManager.address.toString().slice(0, 20)}...`);

  log(`Deploying [${mode} proving]...`);
  const startTime = Date.now();

  const interval = setInterval(() => {
    onTick(Date.now() - startTime);
  }, 100);

  try {
    const deployMethod = await accountManager.getDeployMethod();
    const deployed = await deployMethod.send({
      from: state.registeredAddresses[0],
      skipClassPublication: true,
    });

    const durationMs = Date.now() - startTime;
    const address = deployed.address?.toString() ?? "unknown";
    log(`Deployed in ${(durationMs / 1000).toFixed(1)}s — ${address.slice(0, 20)}...`, "success");

    return { address, durationMs, mode };
  } finally {
    clearInterval(interval);
  }
}
