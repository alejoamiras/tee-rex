import { type ProvingMode, TeeRexProver } from "@alejoamiras/tee-rex";
import { getInitialTestAccountsData } from "@aztec/accounts/testing/lazy";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
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
const PROVER_URL = "/prover"; // Proxied via Vite dev server / CloudFront

/** Display-friendly Aztec node URL for the services panel (reads env set by Vite define). */
export const AZTEC_DISPLAY_URL = process.env.AZTEC_NODE_URL || "localhost:8080";

/** Display-friendly prover URL for the services panel (reads env set by Vite define). */
export const PROVER_DISPLAY_URL = process.env.PROVER_URL || "localhost:4000";

/** True when PROVER_URL was set at build time — enables remote proving. */
export const PROVER_CONFIGURED = !!process.env.PROVER_URL;

/** True when TEE_URL was set at build time — enables auto-configuration. */
export const TEE_CONFIGURED = !!process.env.TEE_URL;

/** Display-friendly TEE URL for the services panel. */
export const TEE_DISPLAY_URL = process.env.TEE_URL || "";

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
    const res = await fetch(`${PROVER_URL}/encryption-public-key`, {
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
};

async function doInitializeWallet(log: LogFn): Promise<boolean> {
  log("Creating TeeRexProver...");
  state.prover = new TeeRexProver(PROVER_URL, new WASMSimulator());
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
      state.prover.setApiUrl(PROVER_URL);
      state.prover.setAttestationConfig({});
      break;
    case "remote":
      state.provingMode = "remote";
      state.prover.setProvingMode("remote");
      state.prover.setApiUrl(PROVER_URL);
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
  if (!state.proofsRequired && !state.registeredAddresses.length) {
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
      from: state.proofsRequired ? AztecAddress.ZERO : state.registeredAddresses[0],
      skipClassPublication: true,
      fee: { paymentMethod: state.feePaymentMethod! },
    });

    const durationMs = Date.now() - startTime;
    const address = deployed.address?.toString() ?? "unknown";
    log(`Deployed in ${(durationMs / 1000).toFixed(1)}s — ${address.slice(0, 20)}...`, "success");

    // On live networks, store the deployed address for use in subsequent operations
    if (state.proofsRequired) {
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
