import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { WASMSimulator } from "@aztec/simulator/client";
import {
  registerInitialLocalNetworkAccountsInWallet,
  TestWallet,
} from "@aztec/test-wallet/client/lazy";
import { type ProvingMode, TeeRexProver } from "@nemi-fi/tee-rex";

export type LogFn = (msg: string, level?: "info" | "warn" | "error" | "success") => void;

const AZTEC_NODE_URL = "/aztec"; // Proxied via Vite dev server
const TEEREX_URL = "http://localhost:4000";

export interface AztecState {
  node: ReturnType<typeof createAztecNodeClient> | null;
  prover: TeeRexProver | null;
  wallet: TestWallet | null;
  registeredAddresses: unknown[];
  provingMode: ProvingMode;
}

export const state: AztecState = {
  node: null,
  prover: null,
  wallet: null,
  registeredAddresses: [],
  provingMode: "remote",
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
    const res = await fetch(`${TEEREX_URL}/encryption-public-key`, {
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
    state.prover = new TeeRexProver(TEEREX_URL, new WASMSimulator());
    state.prover.setProvingMode(state.provingMode);

    log("Connecting to Aztec node...");
    state.node = createAztecNodeClient(AZTEC_NODE_URL);
    const nodeInfo = await state.node.getNodeInfo();
    log(`Connected — chain ${nodeInfo.l1ChainId}`, "success");

    log("Creating wallet (may take a moment)...");
    state.wallet = await TestWallet.create(
      state.node,
      {},
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

export function setProvingMode(mode: ProvingMode): void {
  state.provingMode = mode;
  if (state.prover) {
    state.prover.setProvingMode(mode);
  }
}

export interface DeployResult {
  address: string;
  durationMs: number;
  mode: ProvingMode;
}

export async function deployTestAccount(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
): Promise<DeployResult> {
  if (!state.wallet || !state.registeredAddresses.length) {
    throw new Error("Wallet not initialized");
  }

  const mode = state.provingMode;
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
