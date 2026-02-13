/**
 * Diagnostic test: exercises local proving (deploy) with real IVC proofs.
 * Uses ?forceProofs=true to enable real proving even on sandbox.
 * Captures browser console output with timestamps for debugging.
 *
 * Usage: bunx playwright test --project=fullstack local-proving
 */
import { expect, test } from "@playwright/test";

// Long timeout — real IVC proving can take several minutes
test.setTimeout(10 * 60 * 1000);

test("local proving deploy completes with real IVC", async ({ browser }) => {
  const page = await browser.newPage();
  const t0 = Date.now();

  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  page.on("console", (msg) => {
    console.log(`[${elapsed()}] [${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[${elapsed()}] [PAGE ERROR] ${err.message}`);
  });

  // Clear stale IndexedDB, then load with forceProofs to trigger real IVC
  await page.goto("/?forceProofs=true");
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.filter((db) => db.name).map((db) => indexedDB.deleteDatabase(db.name!)));
  });
  await page.goto("/?forceProofs=true");

  // Wait for wallet init
  console.log(`\n[${elapsed()}] --- Waiting for wallet init ---`);
  const walletState = page.locator("#wallet-state");
  await expect(walletState).not.toHaveText("not initialized", {
    timeout: 30_000,
  });
  await expect(walletState).not.toHaveText("initializing...", {
    timeout: 3 * 60 * 1000,
  });
  const state = await walletState.textContent();
  console.log(`[${elapsed()}] --- Wallet state: "${state}" ---`);
  expect(state).toBe("ready");

  // Verify proofs are enabled (forceProofs=true)
  const networkLabel = await page.locator("#network-label").textContent();
  console.log(`[${elapsed()}] --- Network: "${networkLabel}" ---`);
  expect(networkLabel).toBe("proofs enabled");

  // Verify we're in local mode (default now)
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  console.log(`[${elapsed()}] --- Local mode active, starting deploy ---`);

  // Click deploy
  await page.click("#deploy-btn");
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  // Monitor progress — log every 10s
  const monitor = setInterval(async () => {
    try {
      const elapsedText = await page.locator("#elapsed-time").textContent();
      const progressText = await page.locator("#progress-text").textContent();
      console.log(`[${elapsed()}] --- Progress: ${progressText} | ${elapsedText} ---`);
    } catch {
      /* page might be navigating */
    }
  }, 10_000);

  try {
    // Wait for deploy to complete (up to 8 min)
    await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
      timeout: 8 * 60 * 1000,
    });
    console.log(`\n[${elapsed()}] --- Deploy completed! ---`);

    // Check results
    const logContent = await page.locator("#log").textContent();
    if (logContent?.includes("Deployed in")) {
      console.log(`[${elapsed()}] --- SUCCESS: ${logContent.match(/Deployed in .*/)?.[0]} ---`);
    } else if (logContent?.includes("failed")) {
      console.log(`[${elapsed()}] --- FAILED ---`);
      console.log(logContent);
    }
  } finally {
    clearInterval(monitor);
  }

  await page.close();
});
