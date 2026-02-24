/**
 * Deploy-only smoke tests — runs against nextnet/devnet with real proofs.
 *
 * 4 tests: one deploy per mode (Nitro, SGX, remote, local). No token flow,
 * no mode switching — just verifies that each proving mode can deploy
 * an account successfully. Used by infra.yml, deploy-prod.yml, and
 * deploy-devnet.yml pipelines.
 *
 * Usage: bun run --cwd packages/app test:e2e:smoke
 */
import { expect, type Page, test } from "@playwright/test";
import {
  assertNitroAttested,
  assertSgxAttested,
  deployAndAssert,
  initSharedPage,
} from "./fullstack.helpers";

const PROVER_URL = process.env.PROVER_URL || "";
const TEE_URL = process.env.TEE_URL || "";
const SGX_URL = process.env.SGX_URL || "";

let sharedPage: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  sharedPage = await initSharedPage(browser);
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// ── Nitro ──

test.describe("Nitro", () => {
  test.beforeEach(() => {
    test.skip(!TEE_URL, "TEE_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-nitro");
    await expect(page.locator("#mode-nitro")).toHaveClass(/mode-active/);
    await assertNitroAttested(page);
    await deployAndAssert(page, "nitro");
  });
});

// ── SGX ──

test.describe("SGX", () => {
  test.beforeEach(() => {
    test.skip(!SGX_URL, "SGX_URL env var not set");
  });

  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-sgx");
    await expect(page.locator("#mode-sgx")).toHaveClass(/mode-active/);
    await assertSgxAttested(page);
    await deployAndAssert(page, "sgx");
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
    await deployAndAssert(page, "remote");
  });
});

// ── Local ──

test.describe("local", () => {
  test("deploys account", async () => {
    const page = sharedPage;
    await page.click("#mode-local");
    await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
    await deployAndAssert(page, "local");
  });
});
