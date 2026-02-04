/**
 * Integration test for TeeRexProver with a real Aztec network.
 * Uses @aztec/test-wallet for proper wallet abstraction.
 *
 * Prerequisites:
 * - Aztec local network running: `aztec start --local-network`
 * - Tee-rex server running: `cd server && pnpm start`
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import {
  TestWallet,
  registerInitialLocalNetworkAccountsInWallet,
} from "@aztec/test-wallet/server";
import { WASMSimulator } from "@aztec/simulator/client";
import { Fr } from "@aztec/aztec.js/fields";
import { ProvingMode, TeeRexProver } from "./TeeRexProver.js";

const NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const TEEREX_URL = process.env.TEEREX_URL || "http://localhost:4000";

// Test levels - can be controlled via env var
const TEST_LEVEL = parseInt(process.env.TEST_LEVEL || "6", 10);

async function main() {
  console.log("🚀 Starting TeeRexProver Integration Test");
  console.log(`   Node URL: ${NODE_URL}`);
  console.log(`   TeeRex URL: ${TEEREX_URL}`);
  console.log(`   Test Level: ${TEST_LEVEL}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 1: Basic connectivity
  // ═══════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════");
  console.log("LEVEL 1: Basic Connectivity");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("1.1 Connecting to Aztec node...");
  const node = createAztecNodeClient(NODE_URL);

  try {
    const nodeInfo = await node.getNodeInfo();
    console.log(`    ✅ Connected to node (chain: ${nodeInfo.l1ChainId})`);
  } catch (e) {
    console.error("    ❌ Failed to connect to node. Is the sandbox running?");
    console.error(`    Error: ${e}`);
    process.exit(1);
  }

  console.log("1.2 Verifying tee-rex server...");
  try {
    const response = await fetch(`${TEEREX_URL}/encryption-public-key`);
    const data = await response.json();
    if (!data.publicKey) throw new Error("No public key");
    console.log("    ✅ Tee-rex server is reachable");
  } catch (e) {
    console.error("    ❌ Failed to connect to tee-rex server");
    process.exit(1);
  }

  if (TEST_LEVEL < 2) {
    console.log("\n🎉 Level 1 completed!");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 2: Create TeeRexProver
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LEVEL 2: Create TeeRexProver");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("2.1 Creating TeeRexProver with remote mode...");
  const prover = new TeeRexProver(TEEREX_URL, new WASMSimulator());
  prover.setProvingMode(ProvingMode.remote);
  console.log("    ✅ TeeRexProver created");

  if (TEST_LEVEL < 3) {
    console.log("\n🎉 Level 2 completed!");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 3: Create TestWallet with TeeRexProver
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LEVEL 3: Create TestWallet with TeeRexProver");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("3.1 Creating TestWallet with TeeRexProver as backend...");
  const wallet = await TestWallet.create(
    node,
    {},
    {
      proverOrOptions: prover,
      loggers: {},
    },
  );
  console.log("    ✅ TestWallet created with TeeRexProver");

  if (TEST_LEVEL < 4) {
    console.log("\n🎉 Level 3 completed!");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 4: Register sandbox accounts
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LEVEL 4: Register Sandbox Accounts");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("4.1 Registering initial local network accounts...");
  const registeredAddresses =
    await registerInitialLocalNetworkAccountsInWallet(wallet);
  console.log(
    `    ✅ Registered ${registeredAddresses.length} sandbox accounts`,
  );
  for (const addr of registeredAddresses) {
    console.log(`       - ${addr.toString()}`);
  }

  if (TEST_LEVEL < 5) {
    console.log("\n🎉 Level 4 completed!");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 5: Create and deploy a new account (triggers proving!)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LEVEL 5: Deploy New Account (Triggers Remote Proving!)");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("5.1 Creating new Schnorr account...");
  const secret = Fr.random();
  const salt = Fr.random();
  const accountManager = await wallet.createSchnorrAccount(secret, salt);
  console.log(
    `    ✅ New account created: ${accountManager.address.toString()}`,
  );

  console.log("5.2 Deploying account (this triggers remote proving!)...");
  console.log(
    "    ⏳ This may take a while as proofs are generated remotely...",
  );

  const startTime = Date.now();
  try {
    const deployMethod = await accountManager.getDeployMethod();
    // Deploy with self-payment (from: AztecAddress.ZERO means self-deploy)
    const deployedContract = await deployMethod.send({
      from: registeredAddresses[0], // Use first sandbox account to pay
      skipClassPublication: true, // Class already published
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`    ✅ Account deployed successfully!`);
    console.log(`    📜 Contract: ${deployedContract.address?.toString()}`);
    console.log(`    ⏱️  Time: ${elapsed}s`);
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`    ❌ Deployment failed after ${elapsed}s`);
    console.error(`    Error: ${e}`);
    process.exit(1);
  }

  if (TEST_LEVEL < 6) {
    console.log("\n🎉 Level 5 completed!");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEVEL 6: Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("🎉 ALL LEVELS COMPLETED SUCCESSFULLY!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("   ✅ Aztec node connected");
  console.log("   ✅ Tee-rex server connected");
  console.log("   ✅ TeeRexProver created with remote mode");
  console.log("   ✅ TestWallet created with TeeRexProver backend");
  console.log("   ✅ Sandbox accounts registered");
  console.log("   ✅ New account deployed with remote proving");
  console.log("");
  console.log(
    "   TeeRexProver is fully working with Aztec 4.0.0-nightly.20260204!",
  );
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
