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

// ── Helpers ──

async function deployAndAssert(
  page: Page,
  mode: "local" | "remote" | "tee",
  expectedTag: string,
): Promise<void> {
  await page.click("#deploy-btn");

  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#deploy-btn")).toHaveText("Proving...");

  await expect(page.locator("#deploy-btn")).toHaveText("Deploy Test Account", {
    timeout: 10 * 60 * 1000,
  });

  await expect(page.locator("#progress")).toHaveClass(/hidden/);
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator(`#time-${mode}`).textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator(`#tag-${mode}`)).toHaveText(expectedTag);
  await expect(page.locator(`#result-${mode}`)).toHaveClass(/result-filled/);
  await expect(page.locator("#log")).toContainText("Deployed in");

  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
}

async function runTokenFlowAndAssert(page: Page, mode: "local" | "remote" | "tee"): Promise<void> {
  await page.click("#token-flow-btn");

  await expect(page.locator("#progress")).not.toHaveClass(/hidden/);
  await expect(page.locator("#token-flow-btn")).toHaveText("Running...");

  await expect(page.locator("#token-flow-btn")).toHaveText("Run Token Flow", {
    timeout: 10 * 60 * 1000,
  });

  await expect(page.locator("#progress")).toHaveClass(/hidden/);
  await expect(page.locator("#results")).not.toHaveClass(/hidden/);

  const timeText = await page.locator(`#time-${mode}`).textContent();
  expect(timeText).not.toBe("—");
  expect(timeText).toMatch(/^\d+\.\d+s$/);

  await expect(page.locator(`#tag-${mode}`)).toHaveText("token flow");

  await expect(page.locator("#log")).toContainText("step breakdown");
  await expect(page.locator("#log")).toContainText("Token flow complete");
  await expect(page.locator("#log")).toContainText("Alice: 500");
  await expect(page.locator("#log")).toContainText("Bob: 500");

  await expect(page.locator("#deploy-btn")).toBeEnabled();
  await expect(page.locator("#token-flow-btn")).toBeEnabled();
}

/** Fill TEE URL and verify attestation. Idempotent — safe to call multiple times. */
async function configureTee(page: Page): Promise<void> {
  await expect(page.locator("#tee-config")).not.toHaveClass(/hidden/);
  await page.fill("#tee-url", TEE_URL);
  await page.click("#tee-check-btn");
  await expect(page.locator("#tee-attestation-dot")).toHaveClass(/status-online/, {
    timeout: 30_000,
  });
}

// ── Remote proving ──

test.describe("remote", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "remote", "cold");
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "remote");
  });

  test("remote → local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local", "cold");
  });

  test("remote → TEE deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore remote mode (previous test left us in local)
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    // Switch to TEE
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await configureTee(page);
    await expect(page.locator("#tee-attestation-label")).toContainText("nitro");
    await expect(page.locator("#log")).toContainText("TEE server reachable");
    await deployAndAssert(page, "tee", "cold");
  });
});

// ── Local proving ──

test.describe("local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local", "warm");
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "local");
  });

  test("local → remote deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to remote proving mode");
    await deployAndAssert(page, "remote", "warm");
  });

  test("local → TEE deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore local mode (previous test left us in remote)
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    // Switch to TEE
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await configureTee(page);
    await deployAndAssert(page, "tee", "warm");
  });
});

// ── TEE proving ──

test.describe("TEE", () => {
  test.beforeEach(() => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await configureTee(page);
    await deployAndAssert(page, "tee", "warm");
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "tee");
  });

  test("TEE → local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local", "warm");
  });

  test("TEE → remote deploys successfully", async () => {
    const page = sharedPage;
    // Restore TEE mode (previous test left us in local)
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    // Switch to remote
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to remote proving mode");
    await deployAndAssert(page, "remote", "warm");
  });
});
