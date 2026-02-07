import { expect, type Page, test } from "@playwright/test";
import { assertServicesAvailable } from "./fullstack.fixture";

const TEE_URL = process.env.TEE_URL || "";

let sharedPage: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await assertServicesAvailable();

  // Share a single page across all tests — wallet init is expensive
  // and browser IndexedDB is flaky with repeated init/teardown cycles.
  //
  // Known issue: Aztec PXE's registerInitialLocalNetworkAccountsInWallet
  // uses IndexedDB transactions that can auto-commit in real browsers
  // (TransactionInactiveError). This is acknowledged in Aztec's NoteStore.
  // Workaround: clear IDB and reload on failure.
  sharedPage = await browser.newPage();

  const MAX_INIT_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
    // Navigate to app, then clear IndexedDB and reload for a clean slate.
    // (IDB is only accessible from a real origin, not about:blank.)
    await sharedPage.goto("/");
    if (attempt > 1) {
      await sharedPage.evaluate(async () => {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs.filter((db) => db.name).map((db) => indexedDB.deleteDatabase(db.name!)),
        );
      });
      await sharedPage.reload();
    }

    // Wait for wallet-state to leave "initializing..." — it becomes
    // either "ready" (success) or "failed" (IDB error).
    const walletState = sharedPage.locator("#wallet-state");
    await expect(walletState).not.toHaveText("not initialized", { timeout: 30_000 });
    await expect(walletState).not.toHaveText("initializing...", { timeout: 3 * 60 * 1000 });

    const text = await walletState.textContent();
    if (text === "ready") break;

    if (attempt === MAX_INIT_ATTEMPTS) {
      throw new Error(`Wallet initialization failed after ${MAX_INIT_ATTEMPTS} attempts`);
    }
    // Will retry with fresh IDB on next iteration
  }

  await expect(sharedPage.locator("#deploy-btn")).toBeEnabled();
  await expect(sharedPage.locator("#token-flow-btn")).toBeEnabled();
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

test("deploys account via remote proving through the UI", async () => {
  const page = sharedPage;

  // Default mode is remote
  await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);

  // Click deploy
  await page.click("#deploy-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  // Wait for proving to complete (button text reverts)
  await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with remote card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-remote").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-remote")).toHaveText("cold");
  await expect(page.locator("#result-remote")).toHaveClass(/result-filled/);

  // Log contains success message
  await expect(page.locator("#log")).toContainText("Deployed in");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("runs full token deploy-mint-transfer flow through the UI", async () => {
  const page = sharedPage;

  // Click token flow
  await page.click("#token-flow-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#token-flow-btn")).toHaveText("Running...");

  // Wait for flow to complete (button text reverts)
  await expect(page.locator("#token-flow-btn")).toHaveText("Run Token Flow", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with remote card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-remote").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-remote")).toHaveText("token flow");

  // Log contains step breakdown
  await expect(page.locator("#log")).toContainText("step breakdown");
  await expect(page.locator("#log")).toContainText("deploy token");
  await expect(page.locator("#log")).toContainText("mint to private");
  await expect(page.locator("#log")).toContainText("private transfer");
  await expect(page.locator("#log")).toContainText("check balances");
  await expect(page.locator("#log")).toContainText("Token flow complete");

  // Balance verification
  await expect(page.locator("#log")).toContainText("Alice: 500");
  await expect(page.locator("#log")).toContainText("Bob: 500");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("deploys account via local proving through the UI", async () => {
  const page = sharedPage;

  // Switch to local mode
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#log")).toContainText("Switched to local proving mode");

  // Click deploy
  await page.click("#deploy-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  // Wait for proving to complete (local WASM proving can be slow)
  await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with local card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-local").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-local")).toHaveText("cold");
  await expect(page.locator("#result-local")).toHaveClass(/result-filled/);

  // Log contains success message
  await expect(page.locator("#log")).toContainText("Deployed in");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("runs full token flow via local proving through the UI", async () => {
  const page = sharedPage;

  // Should still be in local mode from previous test
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);

  // Click token flow
  await page.click("#token-flow-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#token-flow-btn")).toHaveText("Running...");

  // Wait for flow to complete (local WASM proving can be slow)
  await expect(page.locator("#token-flow-btn")).toHaveText("Run Token Flow", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with local card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-local").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-local")).toHaveText("token flow");

  // Log contains step breakdown
  await expect(page.locator("#log")).toContainText("step breakdown");
  await expect(page.locator("#log")).toContainText("Token flow complete");

  // Balance verification
  await expect(page.locator("#log")).toContainText("Alice: 500");
  await expect(page.locator("#log")).toContainText("Bob: 500");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("switches from local to remote and deploys successfully", async () => {
  const page = sharedPage;

  // Currently in local mode — switch to remote
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await page.click("#mode-remote");
  await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
  await expect(page.locator("#log")).toContainText("Switched to remote proving mode");

  // Click deploy
  await page.click("#deploy-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  // Wait for proving to complete
  await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with remote card updated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-remote").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  // Second remote deploy → "warm" tag
  await expect(page.locator("#tag-remote")).toHaveText("warm");
  await expect(page.locator("#result-remote")).toHaveClass(/result-filled/);

  // Log contains success message
  await expect(page.locator("#log")).toContainText("Deployed in");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("deploys account via TEE proving through the UI", async () => {
  test.skip(!TEE_URL, "TEE_URL env var not set — skipping TEE tests");

  const page = sharedPage;

  // Switch to TEE mode
  await page.click("#mode-tee");
  await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
  await expect(page.locator("#tee-config")).not.toHaveClass(/hidden/);

  // Enter TEE server URL and check attestation
  await page.fill("#tee-url", TEE_URL);
  await page.click("#tee-check-btn");

  // Wait for attestation check — should show nitro mode
  await expect(page.locator("#tee-attestation-dot")).toHaveClass(/status-online/, {
    timeout: 30_000,
  });
  await expect(page.locator("#tee-attestation-label")).toContainText("nitro");
  await expect(page.locator("#log")).toContainText("TEE server reachable");

  // Click deploy
  await page.click("#deploy-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  // Wait for proving to complete
  await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with TEE card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-tee").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-tee")).toHaveText("cold");
  await expect(page.locator("#result-tee")).toHaveClass(/result-filled/);

  // Log contains success message
  await expect(page.locator("#log")).toContainText("Deployed in");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});

test("runs full token flow via TEE proving through the UI", async () => {
  test.skip(!TEE_URL, "TEE_URL env var not set — skipping TEE tests");

  const page = sharedPage;

  // Should still be in TEE mode from previous test
  await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);

  // Click token flow
  await page.click("#token-flow-btn");

  // Progress indicator appears
  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#token-flow-btn")).toHaveText("Running...");

  // Wait for flow to complete
  await expect(page.locator("#token-flow-btn")).toHaveText("Run Token Flow", {
    timeout: 10 * 60 * 1000,
  });

  // Progress hidden
  await expect(page.locator("#progress")).toHaveClass(/hidden/);

  // Results section visible with TEE card populated
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator("#time-tee").textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator("#tag-tee")).toHaveText("token flow");

  // Log contains step breakdown
  await expect(page.locator("#log")).toContainText("step breakdown");
  await expect(page.locator("#log")).toContainText("Token flow complete");

  // Balance verification
  await expect(page.locator("#log")).toContainText("Alice: 500");
  await expect(page.locator("#log")).toContainText("Bob: 500");

  // Buttons re-enabled
  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
});
