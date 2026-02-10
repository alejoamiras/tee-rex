import { type ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { getInitialTestAccountsData } from "@aztec/accounts/testing/lazy";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { WASMSimulator } from "@aztec/simulator/client";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { TestWallet } from "@aztec/test-wallet/client/lazy";

export type LogFn = (msg: string, level?: "info" | "warn" | "error" | "success") => void;

export type UiMode = "local" | "remote" | "tee";

const AZTEC_NODE_URL = "/aztec"; // Proxied via Vite dev server
const LOCAL_TEEREX_URL = "http://localhost:4000";

/** Display-friendly Aztec node URL for the services panel (reads env set by Vite define). */
export const AZTEC_DISPLAY_URL = process.env.AZTEC_NODE_URL || "localhost:8080";

export interface AztecState {
  node: ReturnType<typeof createAztecNodeClient> | null;
  prover: TeeRexProver | null;
  wallet: TestWallet | null;
  registeredAddresses: AztecAddress[];
  provingMode: ProvingMode;
  uiMode: UiMode;
  teeServerUrl: string;
  isLiveNetwork: boolean;
  feePaymentMethod: SponsoredFeePaymentMethod | undefined;
}

export const state: AztecState = {
  node: null,
  prover: null,
  wallet: null,
  registeredAddresses: [],
  provingMode: "remote",
  uiMode: "remote",
  teeServerUrl: "",
  isLiveNetwork: false,
  feePaymentMethod: undefined,
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

async function clearIndexedDB(): Promise<void> {
  const dbs = await indexedDB.databases();
  await Promise.all(dbs.filter((db) => db.name).map((db) => indexedDB.deleteDatabase(db.name!)));
}

async function doInitializeWallet(log: LogFn): Promise<boolean> {
  log("Creating TeeRexProver...");
  state.prover = new TeeRexProver(LOCAL_TEEREX_URL, new WASMSimulator());
  state.prover.setProvingMode(state.provingMode);

  log("Connecting to Aztec node...");
  state.node = createAztecNodeClient(AZTEC_NODE_URL);
  const [nodeInfo, l1Contracts] = await Promise.all([
    state.node.getNodeInfo(),
    state.node.getL1ContractAddresses(),
  ]);

  state.isLiveNetwork = nodeInfo.l1ChainId !== 31337;
  log(
    `Connected — chain ${nodeInfo.l1ChainId} (${state.isLiveNetwork ? "live network" : "sandbox"})`,
    "success",
  );

  if (state.isLiveNetwork) {
    log("Live network detected — enabling proofs + sponsored fees");
  }

  log("Creating wallet (may take a moment)...");
  // Pre-fetch l1Contracts and pass them in config to avoid extra async
  // operations during PXE init (prevents IndexedDB transaction timeouts).
  // Pattern from gregoswap's EmbeddedWallet.
  state.wallet = await TestWallet.create(
    state.node,
    {
      dataDirectory: `tee-rex-demo-${l1Contracts.rollupAddress}`,
      l1Contracts,
      ...(state.isLiveNetwork && { proverEnabled: true }),
    },
    {
      proverOrOptions: state.prover,
      loggers: {},
    },
  );
  log("Wallet created", "success");

  // Derive the canonical Sponsored FPC address and register it in the PXE.
  // Both sandbox and live networks have it deployed.
  log("Setting up Sponsored FPC...");
  const fpcInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  );
  await state.wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
  state.feePaymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);
  log(`Sponsored FPC registered — ${fpcInstance.address.toString().slice(0, 20)}...`, "success");

  if (!state.isLiveNetwork) {
    log("Registering sandbox accounts...");
    // Register accounts serially to avoid IndexedDB TransactionInactiveError.
    // The SDK's registerInitialLocalNetworkAccountsInWallet uses Promise.all
    // which causes concurrent IDB writes that conflict in real browsers.
    const testAccounts = await getInitialTestAccountsData();
    state.registeredAddresses = [];
    for (const account of testAccounts) {
      const mgr = await state.wallet.createSchnorrAccount(
        account.secret,
        account.salt,
        account.signingKey,
      );
      state.registeredAddresses.push(mgr.address);
    }
    log(`Registered ${state.registeredAddresses.length} accounts`, "success");
  }

  return true;
}

const MAX_INIT_ATTEMPTS = 3;

export async function initializeWallet(log: LogFn): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
    try {
      return await doInitializeWallet(log);
    } catch (err) {
      if (attempt < MAX_INIT_ATTEMPTS) {
        log(
          `Wallet init failed (attempt ${attempt}/${MAX_INIT_ATTEMPTS}), clearing stale data...`,
          "warn",
        );
        await clearIndexedDB();
      } else {
        log(`Wallet initialization failed: ${err}`, "error");
        return false;
      }
    }
  }
  return false;
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

export interface TokenFlowStepTiming {
  step: string;
  durationMs: number;
}

export interface TokenFlowResult {
  mode: UiMode;
  steps: TokenFlowStepTiming[];
  totalDurationMs: number;
  aliceBalance: bigint;
  bobBalance: bigint;
  tokenAddress: string;
}

export async function deployTestAccount(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
): Promise<DeployResult> {
  if (!state.wallet) {
    throw new Error("Wallet not initialized");
  }
  if (!state.isLiveNetwork && !state.registeredAddresses.length) {
    throw new Error("Wallet not initialized — no registered addresses");
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
      from: state.isLiveNetwork ? AztecAddress.ZERO : state.registeredAddresses[0],
      skipClassPublication: true,
      fee: { paymentMethod: state.feePaymentMethod! },
    });

    const durationMs = Date.now() - startTime;
    const address = deployed.address?.toString() ?? "unknown";
    log(`Deployed in ${(durationMs / 1000).toFixed(1)}s — ${address.slice(0, 20)}...`, "success");

    // On live networks, store the deployed address for use in subsequent operations
    if (state.isLiveNetwork) {
      state.registeredAddresses.push(accountManager.address);
    }

    return { address, durationMs, mode };
  } finally {
    clearInterval(interval);
  }
}

export async function runTokenFlow(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
  onStep: (stepName: string) => void,
): Promise<TokenFlowResult> {
  if (!state.wallet || state.registeredAddresses.length < 1) {
    throw new Error("Wallet not initialized — deploy at least one account first");
  }

  const mode = state.uiMode;
  const alice = state.registeredAddresses[0];
  const fee = { paymentMethod: state.feePaymentMethod! };
  const steps: TokenFlowStepTiming[] = [];
  const totalStart = Date.now();

  const interval = setInterval(() => {
    onTick(Date.now() - totalStart);
  }, 100);

  try {
    // On live networks, we may need to deploy a second account (bob) for the transfer step
    let bob: AztecAddress;
    if (state.registeredAddresses.length >= 2) {
      bob = state.registeredAddresses[1];
    } else {
      onStep(`deploying bob account [${mode}]`);
      log(`Deploying second account (Bob) for transfer [${mode}]...`);
      const stepStart = Date.now();

      const bobManager = await state.wallet.createSchnorrAccount(Fr.random(), Fr.random());
      const bobDeploy = await bobManager.getDeployMethod();
      await bobDeploy.send({
        from: AztecAddress.ZERO,
        skipClassPublication: true,
        fee,
      });
      bob = bobManager.address;
      state.registeredAddresses.push(bob);

      const stepDuration = Date.now() - stepStart;
      steps.push({ step: "deploy bob", durationMs: stepDuration });
      log(`Bob deployed in ${(stepDuration / 1000).toFixed(1)}s`, "success");
    }

    // Step 1: Deploy TokenContract
    onStep(`deploying token [${mode}]`);
    log(`Deploying TokenContract (admin=Alice) [${mode}]...`);
    let stepStart = Date.now();

    const token = await TokenContract.deploy(state.wallet, alice, "TeeRex", "TREX", 18).send({
      from: alice,
      fee,
    });

    let stepDuration = Date.now() - stepStart;
    steps.push({ step: "deploy token", durationMs: stepDuration });
    log(
      `Token deployed in ${(stepDuration / 1000).toFixed(1)}s — ${token.address.toString().slice(0, 20)}...`,
      "success",
    );

    // Step 2: Mint 1000 TREX to Alice (private)
    onStep(`minting 1000 TREX [${mode}]`);
    log(`Minting 1000 TREX to Alice [${mode}]...`);
    stepStart = Date.now();

    await token.methods.mint_to_private(alice, 1000n).send({ from: alice, fee });

    stepDuration = Date.now() - stepStart;
    steps.push({ step: "mint to private", durationMs: stepDuration });
    log(`Minted in ${(stepDuration / 1000).toFixed(1)}s`, "success");

    // Step 3: Transfer 500 TREX Alice → Bob (private)
    onStep(`transferring 500 TREX [${mode}]`);
    log(`Transferring 500 TREX Alice → Bob [${mode}]...`);
    stepStart = Date.now();

    await token.methods.transfer(bob, 500n).send({ from: alice, fee });

    stepDuration = Date.now() - stepStart;
    steps.push({ step: "private transfer", durationMs: stepDuration });
    log(`Transferred in ${(stepDuration / 1000).toFixed(1)}s`, "success");

    // Step 4: Check balances (simulate, no proof needed)
    onStep("checking balances");
    log("Checking balances...");
    stepStart = Date.now();

    const [aliceBalance, bobBalance] = await Promise.all([
      token.methods.balance_of_private(alice).simulate({ from: alice }),
      token.methods.balance_of_private(bob).simulate({ from: alice }),
    ]);

    stepDuration = Date.now() - stepStart;
    steps.push({ step: "check balances", durationMs: stepDuration });
    log(
      `Balances — Alice: ${aliceBalance}, Bob: ${bobBalance} (${(stepDuration / 1000).toFixed(1)}s)`,
      "success",
    );

    const totalDurationMs = Date.now() - totalStart;
    log(`Token flow complete in ${(totalDurationMs / 1000).toFixed(1)}s`, "success");

    return {
      mode,
      steps,
      totalDurationMs,
      aliceBalance: BigInt(aliceBalance.toString()),
      bobBalance: BigInt(bobBalance.toString()),
      tokenAddress: token.address.toString(),
    };
  } finally {
    clearInterval(interval);
  }
}
