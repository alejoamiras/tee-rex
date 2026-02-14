import { expect, test } from "@playwright/test";

/**
 * Tests for the "unconfigured" state — neither PROVER_URL nor TEE_URL set.
 * Uses the Vite dev server on port 5174 (no env vars).
 * Only local proving is available.
 */

/** Block Aztec requests so the app stays in "services unavailable" state. */
async function mockServicesOffline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

test("remote and TEE buttons are disabled when nothing is configured", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  // Remote button disabled (PROVER_URL not set)
  await expect(page.locator("#mode-remote")).toBeDisabled();

  // TEE button disabled (TEE_URL not set)
  await expect(page.locator("#mode-tee")).toBeDisabled();

  // Local is active by default
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
});

test("force-clicking disabled remote button does not change mode", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  await page.click("#mode-remote", { force: true });
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-remote")).not.toHaveClass(/mode-active/);
});

test("force-clicking disabled TEE button does not change mode", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  await page.click("#mode-tee", { force: true });
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-tee")).not.toHaveClass(/mode-active/);
});

test("teerex service row shows not configured when PROVER_URL not set", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  // Label stays at HTML default ("not configured")
  await expect(page.locator("#teerex-label")).toHaveText("not configured");
  // URL is empty
  await expect(page.locator("#teerex-url")).toHaveText("");
  // Status dot stays unknown (no check was run)
  await expect(page.locator("#teerex-status")).toHaveClass(/status-unknown/);
});

test("TEE service row shows not configured when TEE_URL not set", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
  await expect(page.locator("#tee-url")).toHaveText("");
  await expect(page.locator("#tee-status")).toHaveClass(/status-unknown/);
});
