/**
 * All-in-one setup: deploy + fund a private SponsoredFPC on Aztec testnet.
 *
 * Flow:
 *   1. Generates a random salt (or reuses --salt)
 *   2. Creates an ephemeral Schnorr account, bridges Fee Juice to it, deploys it
 *   3. Uses the funded account to deploy the SponsoredFPC contract
 *   4. Bridges Fee Juice to the FPC and claims it (via FeeJuice protocol contract)
 *   5. Sets SPONSORED_FPC_SALT as a GitHub secret
 *
 * Usage:
 *   L1_PRIVATE_KEY=0x... L1_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/... \
 *     bun run packages/app/scripts/deploy-sponsored-fpc.ts
 *
 *   # Reuse a known salt:
 *   bun run packages/app/scripts/deploy-sponsored-fpc.ts --salt 0x1234...
 *
 *   # Skip deploy (FPC already exists), just bridge more Fee Juice:
 *   bun run packages/app/scripts/deploy-sponsored-fpc.ts --salt 0x1234... --fund-only
 */

import { execSync } from "node:child_process";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createLogger } from "@aztec/foundation/log";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { WASMSimulator } from "@aztec/simulator/client";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fundOnly = args.includes("--fund-only");
const saltIndex = args.indexOf("--salt");
const salt = saltIndex !== -1 ? Fr.fromHexString(args[saltIndex + 1]) : Fr.random();

// ── Environment ───────────────────────────────────────────────────────
const nodeUrl = process.env.AZTEC_NODE_URL || "https://rpc.testnet.aztec-labs.com";
const l1RpcUrl = process.env.L1_RPC_URL;
const l1PrivateKey = process.env.L1_PRIVATE_KEY;
// When minting on testnet, the amount is fixed by the handler contract.
// Pass undefined to use the handler's default mint amount.
const bridgeAmount = process.env.BRIDGE_AMOUNT ? BigInt(process.env.BRIDGE_AMOUNT) : undefined;

if (!l1RpcUrl || !l1PrivateKey) {
  console.error("L1_RPC_URL and L1_PRIVATE_KEY are required.\n");
  console.error("  L1_PRIVATE_KEY=0x... L1_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/... \\");
  console.error("    bun run packages/app/scripts/deploy-sponsored-fpc.ts\n");
  process.exit(1);
}

// ── L1 wallet ────────────────────────────────────────────────────────
const l1Account = privateKeyToAccount(l1PrivateKey as `0x${string}`);
const l1Client = createWalletClient({
  account: l1Account,
  chain: sepolia,
  transport: http(l1RpcUrl),
}).extend(publicActions);

const logger = createLogger("deploy-fpc");

// ── Derive FPC address ────────────────────────────────────────────────
const fpcInstance = await getContractInstanceFromInstantiationParams(
  SponsoredFPCContract.artifact,
  { salt },
);

console.log("\n  SponsoredFPC Setup");
console.log("  ══════════════════");
console.log(`  L2 Node:     ${nodeUrl}`);
console.log(`  L1 Account:  ${l1Account.address}`);
console.log(`  Salt:        ${salt.toString()}`);
console.log(`  FPC Address: ${fpcInstance.address.toString()}`);
console.log("");

// ── Connect to Aztec node ─────────────────────────────────────────────
const node = createAztecNodeClient(nodeUrl);
const nodeInfo = await node.getNodeInfo();
console.log(`  Connected — chain ${nodeInfo.l1ChainId}, version ${nodeInfo.nodeVersion}`);

// ── Create L1 portal manager ─────────────────────────────────────────
const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);
console.log(`  Fee Juice token: ${portalManager.getTokenManager().tokenAddress.toString()}`);
console.log("");

// ── Helper: wait for L2 to advance N blocks ───────────────────────────
async function waitForBlocks(n: number, timeoutMs = 600_000) {
  const startBlock = await node.getBlockNumber();
  const target = startBlock + n;
  console.log(`  Waiting for L2 block ${target} (currently ${startBlock})...`);

  const pollStart = Date.now();
  while (Date.now() - pollStart < timeoutMs) {
    const current = await node.getBlockNumber();
    if (current >= target) {
      console.log(`  L2 at block ${current} — ready.`);
      return;
    }
    const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
    console.log(`  Block ${current} / ${target}... (${elapsed}s)`);
    await Bun.sleep(15_000);
  }
  throw new Error(`Timed out waiting for L2 block ${target}`);
}

// ── Step 1: Deploy ────────────────────────────────────────────────────
if (!fundOnly) {
  console.log("Step 1: Deploying SponsoredFPC on L2...");

  // Check if already deployed
  let alreadyDeployed = false;
  try {
    const existing = await node.getContract(fpcInstance.address);
    if (existing) {
      console.log("  Already deployed! Skipping to funding.\n");
      alreadyDeployed = true;
    }
  } catch {
    // Not deployed
  }

  if (!alreadyDeployed) {
    // ── Step 1a: Bootstrap a funded account ──────────────────────────
    // On a live network with no pre-funded accounts, we must first deploy
    // a Schnorr account using FeeJuicePaymentMethodWithClaim (bridging from L1).
    // This account then pays for the FPC deployment from its fee juice balance.
    console.log("  Creating ephemeral wallet + Schnorr account...");
    const wallet = await EmbeddedWallet.create(node, {
      ephemeral: true,
      pxeConfig: { proverEnabled: true },
      pxeOptions: { proverOrOptions: new WASMSimulator() },
    });
    const accountManager = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
    const deployerAddress = accountManager.address;
    console.log(`  Deployer: ${deployerAddress.toString()}`);

    // Bridge Fee Juice to the deployer account
    console.log("  Bridging Fee Juice to deployer on L1 (minting)...");
    const deployerClaim = await portalManager.bridgeTokensPublic(
      deployerAddress,
      bridgeAmount,
      true,
    );
    console.log(
      `  Bridged ${deployerClaim.claimAmount} to deployer, leaf: ${deployerClaim.messageLeafIndex}`,
    );

    await waitForBlocks(3);

    // Deploy the Schnorr account — claims bridged Fee Juice in the same tx.
    // DeployAccountMethod handles from: AztecAddress.ZERO correctly.
    console.log("  Deploying deployer account (WASM proving)...");
    const accountDeployMethod = await accountManager.getDeployMethod();
    const accountFee = new FeeJuicePaymentMethodWithClaim(deployerAddress, {
      claimAmount: deployerClaim.claimAmount,
      claimSecret: deployerClaim.claimSecret,
      messageLeafIndex: deployerClaim.messageLeafIndex,
    });
    const { receipt: accountReceipt } = await accountDeployMethod.send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: accountFee },
      wait: { returnReceipt: true },
    });
    console.log(`  Account deployed in block ${accountReceipt.blockNumber}\n`);

    // ── Step 1b: Deploy SponsoredFPC ─────────────────────────────────
    // The deployer account has fee juice. Deploy the FPC paying from that balance.
    console.log("  Deploying SponsoredFPC (WASM proving)...");
    const startTime = Date.now();
    const deployMethod = SponsoredFPCContract.deploy(wallet);
    console.log("  Sending deploy tx...");
    const { receipt } = await deployMethod.send({
      from: deployerAddress,
      contractAddressSalt: salt,
      universalDeploy: true,
      skipClassPublication: true,
      wait: { returnReceipt: true },
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`  SponsoredFPC deployed in block ${receipt.blockNumber} (${elapsed}s)\n`);
  }

  // ── Step 2: Fund the FPC ───────────────────────────────────────────
  // Bridge Fee Juice to FPC address, then claim it via the FeeJuice protocol contract.
  console.log("Step 2: Funding FPC — bridging Fee Juice...");
  const fundClaim = await portalManager.bridgeTokensPublic(fpcInstance.address, bridgeAmount, true);
  console.log(`  Bridged ${fundClaim.claimAmount} to FPC, leaf: ${fundClaim.messageLeafIndex}`);

  await waitForBlocks(3);

  // Claim the bridged Fee Juice for the FPC by calling FeeJuice.claim() directly.
  // FeeJuice protocol contract is at address 0x05.
  // The deployer account (which has remaining fee juice) pays for this tx.
  console.log("  Claiming bridged Fee Juice for FPC...");
  console.log("  Claim details:");
  console.log(`    claimSecret:       ${fundClaim.claimSecret.toString()}`);
  console.log(`    claimAmount:       ${fundClaim.claimAmount}`);
  console.log(`    messageLeafIndex:  ${fundClaim.messageLeafIndex}`);
  console.log(`    messageHash:       ${fundClaim.messageHash}\n`);

  // TODO: Programmatically call FeeJuice.claim(). For now, print the manual command.
  console.log("  Run this to claim (requires aztec-wallet with a funded account):");
  console.log(
    `  aztec-wallet send claim -ca 0x0000000000000000000000000000000000000000000000000000000000000005 \\`,
  );
  console.log(`    -c fee_juice_contract@FeeJuice \\`);
  console.log(
    `    --args ${fpcInstance.address.toString()} ${fundClaim.claimAmount} ${fundClaim.claimSecret.toString()} ${fundClaim.messageLeafIndex} \\`,
  );
  console.log(`    -f <funded-account>\n`);
}

// ── Fund-only: bridge more Fee Juice to an already-deployed FPC ──────
if (fundOnly) {
  console.log("Funding FPC — bridging Fee Juice...");
  console.log(`  To: ${fpcInstance.address.toString()}\n`);

  const claim = await portalManager.bridgeTokensPublic(fpcInstance.address, bridgeAmount, true);
  console.log(`  Bridged ${claim.claimAmount} to FPC, leaf: ${claim.messageLeafIndex}`);
  console.log("  Claim details:");
  console.log(`    claimSecret:       ${claim.claimSecret.toString()}`);
  console.log(`    claimAmount:       ${claim.claimAmount}`);
  console.log(`    messageLeafIndex:  ${claim.messageLeafIndex}`);
  console.log(`    messageHash:       ${claim.messageHash}\n`);
}

// ── Set GitHub secret ─────────────────────────────────────────────────
console.log("Setting GitHub secret...");
try {
  execSync(`gh secret set SPONSORED_FPC_SALT --body "${salt.toString()}"`, { stdio: "inherit" });
  console.log("  SPONSORED_FPC_SALT set.\n");
} catch {
  console.error("  Failed. Run manually:");
  console.error(`  gh secret set SPONSORED_FPC_SALT --body "${salt.toString()}"\n`);
}

// ── Done ──────────────────────────────────────────────────────────────
console.log("  ══════════════════════════════════════════════════");
console.log("  DONE!");
console.log(`  Salt:    ${salt.toString()}`);
console.log(`  Address: ${fpcInstance.address.toString()}`);
console.log("  ══════════════════════════════════════════════════\n");
