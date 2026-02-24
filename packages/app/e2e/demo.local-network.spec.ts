/**
 * Comprehensive frontend E2E tests — runs against local Aztec network.
 *
 * On the local network (chain ID 31337), proofsRequired is automatically
 * false, so operations complete in seconds instead of minutes. This gives
 * us full UI coverage (deploy, token flow, mode switching) without the
 * cost of real proof generation.
 *
 * Usage: bun run --cwd packages/app test:e2e:local-network
 */
import { expect, type Page, test } from "@playwright/test";
import {
  assertNitroAttested,
  deployAndAssert,
  initSharedPage,
  runTokenFlowAndAssert,
} from "./fullstack.helpers";

const PROVER_URL = process.env.PROVER_URL || "";
const TEE_URL = process.env.TEE_URL || "";

let sharedPage: Page;
const deployCount: Record<string, number> = { local: 0, remote: 0, nitro: 0, sgx: 0 };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  sharedPage = await initSharedPage(browser);
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// ── Nitro proving (fastest — run first to minimize stale block headers on live networks) ──

test.describe("Nitro", () => {
  test.beforeEach(() => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-nitro");
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await assertNitroAttested(page);
    await deployAndAssert(page, "nitro", deployCount);
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "nitro");
  });

  test("Nitro -> local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local", deployCount);
  });

  test("Nitro -> remote deploys successfully", async () => {
    const page = sharedPage;
    // Restore Nitro mode (previous test left us in local)
    await page.click("#mode-nitro");
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    // Switch to remote
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to remote proving mode");
    await deployAndAssert(page, "remote", deployCount);
  });
});

// ── Remote proving ──

test.describe("remote", () => {
  test.beforeEach(() => {
    test.skip(!PROVER_URL, "PROVER_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toBeEnabled();
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "remote", deployCount);
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "remote");
  });

  test("remote -> local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local", deployCount);
  });

  test("remote -> Nitro deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore remote mode (previous test left us in local)
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    // Switch to Nitro
    await page.click("#mode-nitro");
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await assertNitroAttested(page);
    await deployAndAssert(page, "nitro", deployCount);
  });
});

// ── Local proving (slowest — run last) ──

test.describe("local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local", deployCount);
  });

  test("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "local");
  });

  test("local -> remote deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to remote proving mode");
    await deployAndAssert(page, "remote", deployCount);
  });

  test("local -> Nitro deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore local mode (previous test left us in remote)
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    // Switch to Nitro
    await page.click("#mode-nitro");
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await assertNitroAttested(page);
    await deployAndAssert(page, "nitro", deployCount);
  });
});
