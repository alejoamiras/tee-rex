/**
 * Comprehensive frontend E2E tests — runs against local Aztec network.
 *
 * On the local network (chain ID 31337), proofsRequired is automatically
 * false, so operations complete in seconds instead of minutes. This gives
 * us full UI coverage (deploy, token flow, mode switching) without the
 * cost of real proof generation.
 *
 * Usage: bun run --cwd packages/playground test:e2e:local-network
 */
import { expect, type Page, test } from "@playwright/test";
import {
  assertTeeAttested,
  deployAndAssert,
  initSharedPage,
  runTokenFlowAndAssert,
} from "./fullstack.helpers";

const PROVER_URL = process.env.PROVER_URL || "";
const TEE_URL = process.env.TEE_URL || "";

let sharedPage: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  sharedPage = await initSharedPage(browser);
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// ── TEE proving (fastest — run first to minimize stale block headers on live networks) ──

test.describe("TEE", () => {
  test.beforeEach(() => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await assertTeeAttested(page);
    await deployAndAssert(page, "tee");
  });

  // TODO: re-enable when Aztec nightly WASM perf regression is resolved (token flow takes ~7 min on CI)
  test.skip("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "tee");
  });

  test("TEE -> local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local");
  });

  test("TEE -> UEE deploys successfully", async () => {
    const page = sharedPage;
    // Restore TEE mode (previous test left us in local)
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    // Switch to UEE
    await page.click("#mode-uee");
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to UEE proving mode");
    await deployAndAssert(page, "uee");
  });
});

// ── UEE proving ──

test.describe("UEE", () => {
  test.beforeEach(() => {
    test.skip(!PROVER_URL, "PROVER_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-uee")).toBeEnabled();
    await page.click("#mode-uee");
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "uee");
  });

  // TODO: re-enable when Aztec nightly WASM perf regression is resolved (token flow takes ~7 min on CI)
  test.skip("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "uee");
  });

  test("UEE -> local deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to local proving mode");
    await deployAndAssert(page, "local");
  });

  test("UEE -> TEE deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore UEE mode (previous test left us in local)
    await page.click("#mode-uee");
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    // Switch to TEE
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await assertTeeAttested(page);
    await deployAndAssert(page, "tee");
  });
});

// ── Local proving (slowest — run last) ──

test.describe("local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local");
  });

  // TODO: re-enable when Aztec nightly WASM perf regression is resolved (token flow takes ~7 min on CI)
  test.skip("runs full token flow", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await runTokenFlowAndAssert(page, "local");
  });

  test("local -> UEE deploys successfully", async () => {
    const page = sharedPage;
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await page.click("#mode-uee");
    await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
    await expect(page.locator("#log")).toContainText("Switched to UEE proving mode");
    await deployAndAssert(page, "uee");
  });

  test("local -> TEE deploys successfully", async () => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
    const page = sharedPage;
    // Restore local mode (previous test left us in UEE)
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    // Switch to TEE
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await assertTeeAttested(page);
    await deployAndAssert(page, "tee");
  });
});
