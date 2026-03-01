import { expect, test } from "@playwright/test";

// ── Helpers ──

/** Block all service requests so the app stays in "services unavailable" state. */
async function mockServicesOffline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
  await page.route("**/prover/**", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

/** Mock both services as healthy. Wallet init will still fail (no real Aztec node). */
async function mockServicesOnline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) => route.fulfill({ status: 200, body: "OK" }));
  await page.route("**/prover/encryption-public-key", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "abc123" }),
    }),
  );
}

// ── Tests (embedded bypass: ?wallet=embedded) ──

test("page loads with correct initial state (embedded bypass)", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // Embedded UI is visible, wallet selection is hidden
  await expect(page.locator("#embedded-ui")).not.toHaveClass(/hidden/);
  await expect(page.locator("#wallet-selection")).toHaveClass(/hidden/);
  await expect(page.locator("#external-ui")).toHaveClass(/hidden/);

  // Local mode button is active by default
  const localBtn = page.locator("#mode-local");
  await expect(localBtn).toHaveClass(/mode-active/);

  // Remote button is enabled (PROVER_URL set via playwright.config) but not active
  const remoteBtn = page.locator("#mode-remote");
  await expect(remoteBtn).not.toHaveClass(/mode-active/);

  // TEE button is disabled (TEE_URL not set)
  const teeBtn = page.locator("#mode-tee");
  await expect(teeBtn).not.toHaveClass(/mode-active/);
  await expect(teeBtn).toBeDisabled();

  // Action buttons are disabled
  await expect(page.locator("#deploy-btn")).toBeDisabled();
  await expect(page.locator("#token-flow-btn")).toBeDisabled();

  // TEE service row shows "not configured" by default
  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
});

test("mode buttons toggle active class (local and remote)", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // Wait for init to settle (remote button gets enabled by checkServices)
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  // Click Local
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-remote")).not.toHaveClass(/mode-active/);

  // Click Remote (enabled because PROVER_URL is set, even if service is offline)
  await page.click("#mode-remote");
  await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-local")).not.toHaveClass(/mode-active/);

  // Click Local again
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-remote")).not.toHaveClass(/mode-active/);
});

test("TEE button is disabled when TEE_URL is not configured", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  await expect(page.locator("#mode-tee")).toBeDisabled();
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
});

test("TEE service row elements are present in the UI", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  await expect(page.locator("#tee-status")).toBeVisible();
  await expect(page.locator("#tee-attestation-label")).toBeVisible();
  await expect(page.locator("#tee-url")).toHaveCount(1);
});

test("TEE service row shows not configured when TEE_URL is not set", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
  await expect(page.locator("#tee-url")).toHaveText("");
});

test("service dots show online and teerex label shows available when services respond OK", async ({
  page,
}) => {
  await mockServicesOnline(page);

  // Block all further RPC calls so wallet init fails gracefully
  await page.route("**/aztec", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: "not a real node" });
    }
    return route.continue();
  });

  await page.goto("/?wallet=embedded");

  // Both service dots should turn green
  await expect(page.locator("#aztec-status")).toHaveClass(/status-online/);
  await expect(page.locator("#teerex-status")).toHaveClass(/status-online/);

  // TEE-Rex label shows "available" and remote button is enabled
  await expect(page.locator("#teerex-label")).toHaveText("available");
  await expect(page.locator("#mode-remote")).toBeEnabled();
});

test("service dots show offline and teerex label shows unavailable when services fail", async ({
  page,
}) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // Aztec dot should be red
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

  // Wait for init to settle
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  // Wallet selection is visible, embedded/external UI are hidden
  await expect(page.locator("#wallet-selection")).not.toHaveClass(/hidden/);
  await expect(page.locator("#embedded-ui")).toHaveClass(/hidden/);
  await expect(page.locator("#external-ui")).toHaveClass(/hidden/);
});

test("?wallet=embedded bypasses wallet selection and shows embedded UI", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  // Embedded UI is visible, wallet selection is hidden
  await expect(page.locator("#embedded-ui")).not.toHaveClass(/hidden/);
  await expect(page.locator("#wallet-selection")).toHaveClass(/hidden/);
});

test("embedded choice button is disabled when Aztec node is offline", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  await expect(page.locator("#log")).toContainText("Checking Aztec node");
  await expect(page.locator("#choose-embedded-btn")).toBeDisabled();
});

test("wallet selection shows connect external button and hides discovery", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  await expect(page.locator("#log")).toContainText("Checking Aztec node");
  await expect(page.locator("#choose-external-btn")).toBeVisible();
  await expect(page.locator("#ext-discovery-section")).toHaveClass(/hidden/);
});

test("external UI elements exist in DOM", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // External UI elements should exist (but hidden)
  await expect(page.locator("#external-ui")).toHaveClass(/hidden/);
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
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  // Click the external wallet button
  await page.click("#choose-external-btn");

  // Discovery section should be visible, choice button should be hidden
  await expect(page.locator("#ext-discovery-section")).not.toHaveClass(/hidden/);
  await expect(page.locator("#choose-external-btn")).toHaveClass(/hidden/);
});

test("cancel discovery returns to choice buttons", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  // Open discovery
  await page.click("#choose-external-btn");
  await expect(page.locator("#ext-discovery-section")).not.toHaveClass(/hidden/);

  // Cancel discovery
  await page.click("#ext-cancel-discovery-btn");

  // Discovery hidden, choice button restored
  await expect(page.locator("#ext-discovery-section")).toHaveClass(/hidden/);
  await expect(page.locator("#choose-external-btn")).not.toHaveClass(/hidden/);
});

test("switch wallet button in embedded services section has correct text", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("Checking Aztec node");

  await expect(page.locator("#switch-to-external-btn")).toHaveText("Switch Wallet");
});
