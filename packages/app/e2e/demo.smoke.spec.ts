/**
 * Deploy-only smoke tests — runs against nextnet/devnet with real proofs.
 *
 * 3 tests: one deploy per mode (TEE, remote, local). No token flow,
 * no mode switching — just verifies that each proving mode can deploy
 * an account successfully. Used by infra.yml, deploy-prod.yml, and
 * deploy-devnet.yml pipelines.
 *
 * Usage: bun run --cwd packages/app test:e2e:smoke
 */
import { expect, type Page, test } from "@playwright/test";
import { assertTeeAttested, deployAndAssert, initSharedPage } from "./fullstack.helpers";

const PROVER_URL = process.env.PROVER_URL || "";
const TEE_URL = process.env.TEE_URL || "";

let sharedPage: Page;
const deployCount: Record<string, number> = { local: 0, remote: 0, tee: 0 };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  sharedPage = await initSharedPage(browser);
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// ── TEE ──

test.describe("TEE", () => {
  test.beforeEach(() => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-tee");
    await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
    await assertTeeAttested(page);
    await deployAndAssert(page, "tee", deployCount);
  });
});

// ── Remote ──

test.describe("remote", () => {
  test.beforeEach(() => {
    test.skip(!PROVER_URL, "PROVER_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-remote");
    await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "remote", deployCount);
  });
});

// ── Local ──

test.describe("local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local", deployCount);
  });
});
