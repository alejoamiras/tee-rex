/**
 * Diagnostic test: exercises only wallet initialization to pinpoint hangs.
 * Captures browser console output with timestamps.
 *
 * Usage: bunx playwright test --project=fullstack wallet-init.diagnostic
 */
import { expect, test } from "@playwright/test";

test("wallet initialization completes", async ({ browser }) => {
  const page = await browser.newPage();
  const logs: string[] = [];
  const t0 = Date.now();

  page.on("console", (msg) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const line = `[${elapsed}s] [${msg.type()}] ${msg.text()}`;
    logs.push(line);
    // Also print to test stdout for live feedback
    console.log(line);
  });

  page.on("pageerror", (err) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${elapsed}s] [PAGE ERROR] ${err.message}`);
    logs.push(`[${elapsed}s] [PAGE ERROR] ${err.message}`);
  });

  // Clear any stale IndexedDB, then load
  await page.goto("/");
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.filter((db) => db.name).map((db) => indexedDB.deleteDatabase(db.name!)));
  });
  await page.reload();

  console.log(`\n--- Waiting for wallet init (up to 3 min) ---\n`);

  const walletState = page.locator("#wallet-state");
  await expect(walletState).not.toHaveText("not initialized", { timeout: 30_000 });

  // This is the critical wait — should not hang with our fixes
  await expect(walletState).not.toHaveText("initializing...", { timeout: 3 * 60 * 1000 });

  const finalState = await walletState.textContent();
  console.log(`\n--- Wallet state: "${finalState}" ---`);
  console.log(`--- Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s ---\n`);

  if (finalState !== "ready") {
    console.log("\n--- Browser console logs ---");
    for (const l of logs) console.log(l);
    console.log("--- End logs ---\n");
  }

  expect(finalState).toBe("ready");

  // Check browser capabilities for proving
  const capabilities = await page.evaluate(() => ({
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated: self.crossOriginIsolated,
  }));
  console.log(`--- Browser capabilities ---`);
  console.log(`  SharedArrayBuffer: ${capabilities.sharedArrayBuffer}`);
  console.log(`  crossOriginIsolated: ${capabilities.crossOriginIsolated}`);
  console.log(`  hardwareConcurrency: ${capabilities.hardwareConcurrency}`);

  await page.close();
});
