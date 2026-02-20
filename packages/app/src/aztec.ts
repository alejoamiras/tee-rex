import { type ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { getInitialTestAccountsData } from "@aztec/accounts/testing/lazy";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import type { TxHash } from "@aztec/aztec.js/tx";
import { createStore } from "@aztec/kv-store/indexeddb";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { createPXE, getPXEConfig } from "@aztec/pxe/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { EmbeddedWallet, WalletDB } from "@aztec/wallets/embedded";

export type LogFn = (msg: string, level?: "info" | "warn" | "error" | "success") => void;

export type UiMode = "local" | "remote" | "tee";

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "/aztec";
/** Vite dev server / CloudFront proxy path for the prover (not the actual URL). */
const PROVER_PROXY_PATH = "/prover";

/** Display-friendly Aztec node URL for the services panel (reads env set by Vite define). */
export const AZTEC_DISPLAY_URL = process.env.AZTEC_NODE_URL || "localhost:8080";

/** Display-friendly prover URL for the services panel (reads env set by Vite define). */
export const PROVER_DISPLAY_URL = process.env.PROVER_URL || "localhost:4000";

/** True when the PROVER_URL env var was set at build time — enables remote proving. */
export const PROVER_CONFIGURED = !!process.env.PROVER_URL;

/** True when TEE_URL was set at build time — enables auto-configuration. */
export const TEE_CONFIGURED = !!process.env.TEE_URL;

/** Display-friendly TEE URL for the services panel. */
export const TEE_DISPLAY_URL = process.env.TEE_URL || "";

/** Environment name: "nextnet", "devnet", or undefined (local dev) */
export const ENV_NAME = process.env.VITE_ENV_NAME || undefined;

const ENV_URLS: Record<string, { other: string; otherName: string }> = {
  nextnet: { other: "https://devnet.tee-rex.dev", otherName: "devnet" },
  devnet: { other: "https://nextnet.tee-rex.dev", otherName: "nextnet" },
};

/** URL to the other environment (for switcher link), or undefined */
export const OTHER_ENV_URL = ENV_NAME ? ENV_URLS[ENV_NAME]?.other : undefined;
export const OTHER_ENV_NAME = ENV_NAME ? ENV_URLS[ENV_NAME]?.otherName : undefined;

export interface AztecState {
  node: ReturnType<typeof createAztecNodeClient> | null;
  prover: TeeRexProver | null;
  wallet: EmbeddedWallet | null;
  registeredAddresses: AztecAddress[];
  provingMode: ProvingMode;
  uiMode: UiMode;
  teeServerUrl: string;
  /** True when the network requires real proofs (not simulated). */
  proofsRequired: boolean;
  feePaymentMethod: SponsoredFeePaymentMethod | undefined;
}

/**
 * Global mutable application state. Concurrent mutations are prevented at
 * the UI layer via the `deploying` flag in main.ts, which disables action
 * buttons while an async operation is in flight.
 */
export const state: AztecState = {
  node: null,
  prover: null,
  wallet: null,
  registeredAddresses: [],
  provingMode: "local",
  uiMode: "local",
  teeServerUrl: "/tee",
  proofsRequired: false,
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
    const res = await fetch(`${PROVER_PROXY_PATH}/encryption-public-key`, {
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
  const aztecPrefixes = ["pxe-", "wallet-", "aztec-"];
  await Promise.all(
    dbs
      .filter((db) => db.name && aztecPrefixes.some((prefix) => db.name!.startsWith(prefix)))
      .map((db) => indexedDB.deleteDatabase(db.name!)),
  );
}

/**
 * Lazy account contracts provider — mirrors @aztec/wallets internal implementation.
 * Uses dynamic imports so Vite can code-split the account contract artifacts.
 */
const lazyAccountContracts = {
  async getSchnorrAccountContract(signingKey: import("@aztec/foundation/curves/bn254").Fq) {
    const { SchnorrAccountContract } = await import("@aztec/accounts/schnorr/lazy");
    return new SchnorrAccountContract(signingKey);
  },
  async getEcdsaRAccountContract(signingKey: Buffer) {
    const { EcdsaRAccountContract } = await import("@aztec/accounts/ecdsa/lazy");
    return new EcdsaRAccountContract(signingKey);
  },
  async getEcdsaKAccountContract(signingKey: Buffer) {
    const { EcdsaKAccountContract } = await import("@aztec/accounts/ecdsa/lazy");
    return new EcdsaKAccountContract(signingKey);
  },
  async getStubAccountContractArtifact() {
    const { getStubAccountContractArtifact } = await import("@aztec/accounts/stub/lazy");
    return getStubAccountContractArtifact();
  },
  async createStubAccount(address: import("@aztec/stdlib/contract").CompleteAddress) {
    const { createStubAccount } = await import("@aztec/accounts/stub/lazy");
    return createStubAccount(address);
  },
  async getMulticallContract() {
    const { getCanonicalMultiCallEntrypoint } = await import(
      "@aztec/protocol-contracts/multi-call-entrypoint/lazy"
    );
    return getCanonicalMultiCallEntrypoint();
  },
};

async function doInitializeWallet(log: LogFn): Promise<boolean> {
  log("Creating TeeRexProver...");
  state.prover = new TeeRexProver(PROVER_PROXY_PATH, new WASMSimulator());
  state.prover.setProvingMode(state.provingMode);

  log("Connecting to Aztec node...");
  state.node = createAztecNodeClient(AZTEC_NODE_URL);
  const [nodeInfo, l1Contracts] = await Promise.all([
    state.node.getNodeInfo(),
    state.node.getL1ContractAddresses(),
  ]);

  const rollupAddress = l1Contracts.rollupAddress;
  state.proofsRequired = nodeInfo.l1ChainId !== 31337;

  // Allow forcing proofs via ?forceProofs=true for testing IVC locally
  const forceProofs = new URLSearchParams(window.location.search).get("forceProofs") === "true";
  if (forceProofs && !state.proofsRequired) {
    state.proofsRequired = true;
    log("Forced proverEnabled=true via ?forceProofs query param", "warn");
  }

  log(
    `Connected — chain ${nodeInfo.l1ChainId} (proofs ${state.proofsRequired ? "required" : "simulated"})`,
    "success",
  );

  log("Creating wallet (may take a moment)...");
  // Mirrors BrowserEmbeddedWallet.create() but injects our TeeRexProver.
  // Pass l1Contracts in the config to avoid extra fetches during PXE init.
  // Only enable proving on live networks (sandbox uses simulated proofs).
  const pxeConfig = getPXEConfig();
  pxeConfig.dataDirectory = `pxe-${rollupAddress}`;
  pxeConfig.proverEnabled = state.proofsRequired;
  pxeConfig.l1Contracts = l1Contracts;

  log("Initializing PXE...");
  const pxe = await createPXE(state.node, pxeConfig, {
    proverOrOptions: state.prover,
  });
  log("PXE initialized", "success");

  log("Creating wallet DB...");
  const walletDBStore = await createStore(`wallet-${rollupAddress}`, {
    dataDirectory: "wallet",
    dataStoreMapSizeKb: 2e10,
  });
  const walletDB = WalletDB.init(walletDBStore, (msg) => log(msg));
  log("Wallet DB created", "success");

  state.wallet = new EmbeddedWallet(pxe, state.node, walletDB, lazyAccountContracts);
  log("Wallet created", "success");

  // Derive the canonical Sponsored FPC address and register it in the PXE.
  log("Setting up Sponsored FPC...");
  const fpcInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  );
  await state.wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
  state.feePaymentMethod = new SponsoredFeePaymentMethod(fpcInstance.address);
  log(`Sponsored FPC registered — ${fpcInstance.address.toString().slice(0, 20)}...`, "success");

  if (!state.proofsRequired) {
    log("Registering sandbox accounts...");
    // Register accounts serially to avoid IndexedDB TransactionInactiveError.
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
      state.prover.setApiUrl(PROVER_PROXY_PATH);
      state.prover.setAttestationConfig({});
      break;
    case "remote":
      state.provingMode = "remote";
      state.prover.setProvingMode("remote");
      state.prover.setApiUrl(PROVER_PROXY_PATH);
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

export interface SimStepDetail {
  syncMs: number;
  totalMs: number;
  perFunction: { name: string; ms: number }[];
}

export interface StepTiming {
  step: string;
  durationMs: number;
  simulation?: SimStepDetail;
  proveSendMs?: number;
  confirmMs?: number;
}

export interface DeployResult {
  address: string;
  steps: StepTiming[];
  totalDurationMs: number;
  mode: UiMode;
}

export interface TokenFlowResult {
  mode: UiMode;
  steps: StepTiming[];
  totalDurationMs: number;
  aliceBalance: bigint;
  bobBalance: bigint;
  tokenAddress: string;
}

interface SimTimings {
  sync?: number;
  total?: number;
  perFunction?: { functionName: string; time: number }[];
}

/** Extract our SimStepDetail from a simulate() result with includeMetadata: true. */
function extractSimDetail(simResult: { stats: { timings: SimTimings } }): SimStepDetail {
  const t = simResult.stats.timings;
  return {
    syncMs: t.sync ?? 0,
    totalMs: t.total ?? 0,
    perFunction: (t.perFunction ?? []).map((f) => ({ name: f.functionName, ms: f.time })),
  };
}

const BLOCK_HEADER_NOT_FOUND = "Block header not found";
const MAX_SEND_ATTEMPTS = 3;

/** Retry stale block headers only in E2E tests — not safe in production
 *  because re-simulating may pick up different contract state. */
const RETRY_STALE_HEADER = !!process.env.E2E_RETRY_STALE_HEADER;

/**
 * Send a tx, optionally retrying on "Block header not found" when enabled
 * via E2E_RETRY_STALE_HEADER. Re-simulates to refresh the block header when
 * proving takes long enough for it to go stale on live networks.
 */
async function sendWithRetry(
  method: { simulate: (opts: any) => Promise<any>; send: (opts: any) => Promise<TxHash> },
  sendOpts: Record<string, unknown>,
  log: LogFn,
): Promise<TxHash> {
  const maxAttempts = RETRY_STALE_HEADER ? MAX_SEND_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        log(`Retrying (attempt ${attempt}/${maxAttempts}) — refreshing block header...`, "warn");
        await method.simulate(sendOpts);
      }
      return await method.send({ ...sendOpts, wait: NO_WAIT });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts && msg.includes(BLOCK_HEADER_NOT_FOUND)) {
        log(`Block header went stale during proving (attempt ${attempt}/${maxAttempts})`, "warn");
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/** Poll until a transaction is no longer pending. Throws on dropped or timed-out txs. */
async function waitForTx(txHash: TxHash): Promise<void> {
  const deadline = Date.now() + 10 * 60 * 1000; // 10 minutes
  while (true) {
    const receipt = await state.node!.getTxReceipt(txHash);
    if (!receipt.isPending()) {
      if (receipt.isDropped()) throw new Error("Transaction dropped");
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("Transaction confirmation timed out after 10 minutes");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function deployTestAccount(
  log: LogFn,
  onTick: (elapsedMs: number) => void,
  onStep: (stepName: string) => void,
): Promise<DeployResult> {
  if (!state.wallet) {
    throw new Error("Wallet not initialized");
  }
  if (!state.proofsRequired && !state.registeredAddresses.length) {
    throw new Error("Wallet not initialized — no registered addresses");
  }

  const mode = state.uiMode;
  const steps: StepTiming[] = [];
  const totalStart = Date.now();

  const interval = setInterval(() => {
    onTick(Date.now() - totalStart);
  }, 100);

  try {
    // Step 1: Create account
    onStep(`creating account [${mode}]`);
    log(`Creating Schnorr account [${mode}]...`);
    let stepStart = Date.now();

    const secret = Fr.random();
    const salt = Fr.random();
    const accountManager = await state.wallet.createSchnorrAccount(secret, salt);
    const deployMethod = await accountManager.getDeployMethod();

    steps.push({ step: "create account", durationMs: Date.now() - stepStart });
    log(`Account: ${accountManager.address.toString().slice(0, 20)}...`);

    const sendOpts = {
      from: state.proofsRequired ? AztecAddress.ZERO : state.registeredAddresses[0],
      skipClassPublication: true,
      fee: { paymentMethod: state.feePaymentMethod! },
    };

    // Step 2: Simulate (captures witness gen timing)
    // Simulate may fail with AztecAddress.ZERO (first deploy on live networks)
    onStep(`simulating deploy [${mode}]`);
    log(`Simulating deploy [${mode}]...`);
    stepStart = Date.now();

    let simDetail: SimStepDetail | undefined;
    try {
      const simResult = await deployMethod.simulate({ ...sendOpts, includeMetadata: true });
      simDetail = extractSimDetail(simResult);
    } catch {
      log("Simulation stats unavailable (first deploy)", "warn");
    }

    steps.push({
      step: "simulate",
      durationMs: Date.now() - stepStart,
      simulation: simDetail,
    });

    // Step 3: Prove + send + confirm
    onStep(`proving + sending [${mode}]`);
    log(`Deploying [${mode} proving]...`);
    stepStart = Date.now();

    const txHash = await sendWithRetry(deployMethod, sendOpts, log);
    const proveSendMs = Date.now() - stepStart;

    onStep(`confirming [${mode}]`);
    const confirmStart = Date.now();
    await waitForTx(txHash);
    const confirmMs = Date.now() - confirmStart;

    steps.push({
      step: "prove + send",
      durationMs: proveSendMs + confirmMs,
      proveSendMs,
      confirmMs,
    });

    const totalDurationMs = Date.now() - totalStart;
    const address = accountManager.address.toString();
    log(
      `Deployed in ${(totalDurationMs / 1000).toFixed(1)}s — ${address.slice(0, 20)}...`,
      "success",
    );

    // On live networks, store the deployed address for use in subsequent operations
    if (state.proofsRequired) {
      state.registeredAddresses.push(accountManager.address);
    }

    return { address, steps, totalDurationMs, mode };
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
  const steps: StepTiming[] = [];
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
      const bobSendOpts = { from: AztecAddress.ZERO, skipClassPublication: true, fee };
      const bobSim = await bobDeploy.simulate({ ...bobSendOpts, includeMetadata: true });

      const bobSendStart = Date.now();
      const bobTxHash = await sendWithRetry(bobDeploy, bobSendOpts, log);
      const bobProveSendMs = Date.now() - bobSendStart;

      onStep(`confirming bob [${mode}]`);
      const bobConfirmStart = Date.now();
      await waitForTx(bobTxHash);
      const bobConfirmMs = Date.now() - bobConfirmStart;

      bob = bobManager.address;
      state.registeredAddresses.push(bob);

      const bobStepDuration = Date.now() - stepStart;
      steps.push({
        step: "deploy bob",
        durationMs: bobStepDuration,
        simulation: extractSimDetail(bobSim),
        proveSendMs: bobProveSendMs,
        confirmMs: bobConfirmMs,
      });
      log(`Bob deployed in ${(bobStepDuration / 1000).toFixed(1)}s`, "success");
    }

    // Step 1: Deploy TokenContract
    onStep(`deploying token [${mode}]`);
    log(`Deploying TokenContract (admin=Alice) [${mode}]...`);
    let stepStart = Date.now();

    const tokenDeploy = TokenContract.deploy(state.wallet, alice, "TeeRex", "TREX", 18);
    const tokenSim = await tokenDeploy.simulate({ from: alice, fee, includeMetadata: true });

    const tokenSendStart = Date.now();
    const tokenTxHash = await sendWithRetry(tokenDeploy, { from: alice, fee }, log);
    const tokenProveSendMs = Date.now() - tokenSendStart;

    onStep(`confirming token deploy [${mode}]`);
    const tokenConfirmStart = Date.now();
    await waitForTx(tokenTxHash);
    const tokenConfirmMs = Date.now() - tokenConfirmStart;

    const token = TokenContract.at(tokenDeploy.address!, state.wallet);

    let stepDuration = Date.now() - stepStart;
    steps.push({
      step: "deploy token",
      durationMs: stepDuration,
      simulation: extractSimDetail(tokenSim),
      proveSendMs: tokenProveSendMs,
      confirmMs: tokenConfirmMs,
    });
    log(
      `Token deployed in ${(stepDuration / 1000).toFixed(1)}s — ${token.address.toString().slice(0, 20)}...`,
      "success",
    );

    // Step 2: Mint 1000 TREX to Alice (private)
    onStep(`minting 1000 TREX [${mode}]`);
    log(`Minting 1000 TREX to Alice [${mode}]...`);
    stepStart = Date.now();

    const mintCall = token.methods.mint_to_private(alice, 1000n);
    const mintSim = await mintCall.simulate({ from: alice, fee, includeMetadata: true });

    const mintSendStart = Date.now();
    const mintTxHash = await sendWithRetry(mintCall, { from: alice, fee }, log);
    const mintProveSendMs = Date.now() - mintSendStart;

    onStep(`confirming mint [${mode}]`);
    const mintConfirmStart = Date.now();
    await waitForTx(mintTxHash);
    const mintConfirmMs = Date.now() - mintConfirmStart;

    stepDuration = Date.now() - stepStart;
    steps.push({
      step: "mint to private",
      durationMs: stepDuration,
      simulation: extractSimDetail(mintSim),
      proveSendMs: mintProveSendMs,
      confirmMs: mintConfirmMs,
    });
    log(`Minted in ${(stepDuration / 1000).toFixed(1)}s`, "success");

    // Step 3: Transfer 500 TREX Alice → Bob (private)
    onStep(`transferring 500 TREX [${mode}]`);
    log(`Transferring 500 TREX Alice → Bob [${mode}]...`);
    stepStart = Date.now();

    const transferCall = token.methods.transfer(bob, 500n);
    const transferSim = await transferCall.simulate({ from: alice, fee, includeMetadata: true });

    const transferSendStart = Date.now();
    const transferTxHash = await sendWithRetry(transferCall, { from: alice, fee }, log);
    const transferProveSendMs = Date.now() - transferSendStart;

    onStep(`confirming transfer [${mode}]`);
    const transferConfirmStart = Date.now();
    await waitForTx(transferTxHash);
    const transferConfirmMs = Date.now() - transferConfirmStart;

    stepDuration = Date.now() - stepStart;
    steps.push({
      step: "private transfer",
      durationMs: stepDuration,
      simulation: extractSimDetail(transferSim),
      proveSendMs: transferProveSendMs,
      confirmMs: transferConfirmMs,
    });
    log(`Transferred in ${(stepDuration / 1000).toFixed(1)}s`, "success");

    // Step 4: Check balances (simulate, no proof needed)
    onStep("checking balances");
    log("Checking balances...");
    stepStart = Date.now();

    const [aliceBalance, bobBalance] = await Promise.all([
      token.methods.balance_of_private(alice).simulate({ from: alice }),
      token.methods.balance_of_private(bob).simulate({ from: bob }),
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
