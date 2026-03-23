import { expect, test } from "@playwright/test";

// ── Helpers ──

/** Block all service requests so the app stays in "services unavailable" state. */
async function mockServicesOffline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
  await page.route("**/aztec", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 503, body: "Service Unavailable" });
    }
    return route.continue();
  });
  await page.route("**/prover/**", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
  await page.route("**/tee/**", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

/** Mock both services as healthy. Wallet init will still fail (no real Aztec node). */
async function mockServicesOnline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) => route.fulfill({ status: 200, body: "OK" }));
  await page.route("**/aztec", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: "not a real node" });
    }
    return route.continue();
  });
  await page.route("**/prover/encryption-public-key", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "abc123" }),
    }),
  );
}

/** Wait for embedded init to settle (services checked, status dots updated). */
async function waitForEmbeddedInit(page: import("@playwright/test").Page) {
  await expect(page.locator("#log")).toContainText("Checking Aztec node", { timeout: 10_000 });
  // Wait for embedded UI to become visible (showEmbeddedUI removes hidden class)
  await expect(page.locator("#embedded-ui")).toBeVisible({ timeout: 10_000 });
  // Wait for service checks to complete — log shows either "not reachable" or status updates
  await expect(page.locator("#log")).toContainText(
    /(TEE-Rex server not reachable|aztec unavailable)/,
    {
      timeout: 10_000,
    },
  );
}

/** Wait for wallet selection to be shown (non-embedded flow). */
async function waitForWalletSelection(page: import("@playwright/test").Page) {
  await expect(page.locator("#log")).toContainText("Checking Aztec node", { timeout: 10_000 });
  // Wallet selection becomes visible after init
  await expect(page.locator("#wallet-selection")).toBeVisible({ timeout: 10_000 });
}

// ── Tests (embedded bypass: ?wallet=embedded) ──

test("page loads with correct initial state (embedded bypass)", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  // Embedded UI is visible
  await expect(page.locator("#embedded-ui")).toBeVisible();

  // Local mode button is active by default
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);

  // UEE button is enabled (PROVER_URL set via playwright.config) but not active
  await expect(page.locator("#mode-uee")).not.toHaveClass(/mode-active/);

  // TEE button is disabled (TEE_URL not set)
  await expect(page.locator("#mode-tee")).toBeDisabled();

  // Action buttons are disabled (no wallet yet)
  await expect(page.locator("#deploy-btn")).toBeDisabled();
  await expect(page.locator("#token-flow-btn")).toBeDisabled();

  // TEE service row shows "not configured" (TEE_URL not set)
  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
});

test("mode buttons toggle active class (local and UEE)", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  // Click Local
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-uee")).not.toHaveClass(/mode-active/);

  // Click UEE (enabled because PROVER_URL is set, even if service is offline)
  await page.click("#mode-uee");
  await expect(page.locator("#mode-uee")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-local")).not.toHaveClass(/mode-active/);

  // Click Local again
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-uee")).not.toHaveClass(/mode-active/);
});

test("TEE button is disabled when TEE_URL is not configured", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  await expect(page.locator("#mode-tee")).toBeDisabled();
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
});

test("TEE service row elements are present in the UI", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  await expect(page.locator("#tee-status")).toBeVisible();
  await expect(page.locator("#tee-attestation-label")).toBeVisible();
  await expect(page.locator("#tee-url")).toHaveCount(1);
});

test("TEE service row shows not configured when TEE_URL is not set", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
  await expect(page.locator("#tee-url")).toHaveText("");
});

test("service dots show online and teerex label shows available when services respond OK", async ({
  page,
}) => {
  await mockServicesOnline(page);
  await page.goto("/?wallet=embedded");

  // Wait for service checks to complete — label changes to "available"
  await expect(page.locator("#teerex-label")).toHaveText("available", { timeout: 10_000 });

  // Both service dots should be green
  await expect(page.locator("#aztec-status")).toHaveClass(/status-online/);
  await expect(page.locator("#teerex-status")).toHaveClass(/status-online/);

  // UEE button is enabled
  await expect(page.locator("#mode-uee")).toBeEnabled();
});

test("service dots show offline and teerex label shows unavailable when services fail", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  // Aztec dot should be red (503)
  await expect(page.locator("#aztec-status")).toHaveClass(/status-offline/);
  // TEE-Rex dot should be red, label "unavailable" (PROVER_URL is set but service is down)
  await expect(page.locator("#teerex-status")).toHaveClass(/status-offline/);
  await expect(page.locator("#teerex-label")).toHaveText("unavailable");
});

test("log panel shows checking Aztec node message on load", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  await expect(page.locator("#log")).toContainText("Checking Aztec node");
});

// ── Wallet selection screen tests ──

test("wallet selection screen appears on load (no query param)", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await waitForWalletSelection(page);

  // Wallet selection is visible, embedded/external UI are hidden
  await expect(page.locator("#wallet-selection")).toBeVisible();
  await expect(page.locator("#embedded-ui")).not.toBeVisible();
  await expect(page.locator("#external-ui")).not.toBeVisible();
});

test("?wallet=embedded bypasses wallet selection and shows embedded UI", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  // Embedded UI is visible, wallet selection is hidden
  await expect(page.locator("#embedded-ui")).toBeVisible();
  await expect(page.locator("#wallet-selection")).not.toBeVisible();
});

test("embedded choice button is disabled when Aztec node is offline", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await waitForWalletSelection(page);

  await expect(page.locator("#choose-embedded-btn")).toBeDisabled();
});

test("wallet selection shows connect external button and hides discovery", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await waitForWalletSelection(page);

  await expect(page.locator("#choose-external-btn")).toBeVisible();
  await expect(page.locator("#ext-discovery-section")).not.toBeVisible();
});

test("external UI elements exist in DOM", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  // External UI elements should exist (but hidden)
  await expect(page.locator("#external-ui")).not.toBeVisible();
  await expect(page.locator("#ext-disconnect-btn")).toHaveCount(1);
  await expect(page.locator("#ext-deploy-token-btn")).toHaveCount(1);
  await expect(page.locator("#ext-token-flow-btn")).toHaveCount(1);
  await expect(page.locator("#ext-results")).toHaveCount(1);

  // Wallet info bar has structured rows
  await expect(page.locator("#ext-network-dot")).toHaveCount(1);
  await expect(page.locator("#ext-network-label")).toHaveCount(1);
  await expect(page.locator("#ext-wallet-icon-placeholder")).toHaveCount(1);
  await expect(page.locator("#ext-wallet-name")).toHaveCount(1);
  await expect(page.locator("#ext-account-selector")).toHaveCount(1);
  await expect(page.locator("#ext-wallet-address")).toHaveCount(1);
});

// ── Wallet selection flow tests ──

test("clicking connect external wallet shows discovery section", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await waitForWalletSelection(page);

  // Click the external wallet button
  await page.click("#choose-external-btn");

  // Discovery section should be visible
  await expect(page.locator("#ext-discovery-section")).toBeVisible({ timeout: 5_000 });
});

test("cancel discovery returns to choice buttons", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await waitForWalletSelection(page);

  // Open discovery
  await page.click("#choose-external-btn");
  await expect(page.locator("#ext-discovery-section")).toBeVisible({ timeout: 5_000 });

  // Cancel discovery
  await page.click("#ext-cancel-discovery-btn");

  // Discovery hidden, choice button visible
  await expect(page.locator("#ext-discovery-section")).not.toBeVisible();
  await expect(page.locator("#choose-external-btn")).toBeVisible();
});

test("switch wallet button in embedded services section has correct text", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await waitForEmbeddedInit(page);

  await expect(page.locator("#switch-to-external-btn")).toHaveText("Switch Wallet");
});
