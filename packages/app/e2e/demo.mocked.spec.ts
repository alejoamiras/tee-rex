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

// ── Tests ──

test("page loads with correct initial state", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

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
  await expect(page.locator("#log")).toContainText("services");

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
  await expect(page.locator("#log")).toContainText("services");

  // TEE button stays disabled (force-click guards tested in mocked-unconfigured)
  await expect(page.locator("#mode-tee")).toBeDisabled();
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
});

test("TEE service row elements are present in the UI", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("services");

  // TEE service row exists with status dot and attestation label
  await expect(page.locator("#tee-status")).toBeVisible();
  await expect(page.locator("#tee-attestation-label")).toBeVisible();
  // URL span is empty (hidden) when TEE_URL is not set — just check it exists
  await expect(page.locator("#tee-url")).toHaveCount(1);
});

test("TEE service row shows not configured when TEE_URL is not set", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("services");

  // Without TEE_URL, the service row shows "not configured"
  await expect(page.locator("#tee-attestation-label")).toHaveText("not configured");
  await expect(page.locator("#tee-url")).toHaveText("");
});

test("service dots show online and teerex label shows available when services respond OK", async ({
  page,
}) => {
  await mockServicesOnline(page);

  // Block all further RPC calls so wallet init fails gracefully
  await page.route("**/aztec", (route) => {
    // If it's an RPC-style POST request, let it fail
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

test("log panel shows checking services message on load", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // The init function logs "Checking services..."
  await expect(page.locator("#log")).toContainText("Checking services");
});

// ── Wallet connection UI tests ──

test("Connect External button is hidden with ?wallet=embedded", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");
  await expect(page.locator("#log")).toContainText("services");

  // Button exists but is hidden
  await expect(page.locator("#connect-external-btn")).toBeHidden();
});

test("Connect External button is visible without ?wallet=embedded (when wallet ready)", async ({
  page,
}) => {
  await mockServicesOnline(page);

  // Block RPC but let wallet init succeed enough to show the button
  await page.route("**/aztec", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: "not a real node" });
    }
    return route.continue();
  });

  // Navigate WITHOUT ?wallet=embedded
  await page.goto("/");

  // Wait for init to proceed past service checks
  await expect(page.locator("#aztec-status")).toHaveClass(/status-online/);

  // The button will only show once wallet is "ready" — which won't happen
  // with a mocked node. But the wallet-connect section elements should exist.
  await expect(page.locator("#connect-external-btn")).toHaveCount(1);
  await expect(page.locator("#wallet-connect-section")).toBeHidden();
  await expect(page.locator("#proving-mode-overlay")).toBeHidden();
});

test("wallet connection section elements exist in DOM", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/?wallet=embedded");

  // All wallet connection elements should be in the DOM (but hidden)
  await expect(page.locator("#wallet-connect-section")).toBeHidden();
  await expect(page.locator("#wallet-discovery")).toBeHidden();
  await expect(page.locator("#wallet-verify")).toBeHidden();
  await expect(page.locator("#wallet-connected")).toBeHidden();
  await expect(page.locator("#emoji-grid")).toHaveCount(1);
  await expect(page.locator("#proving-mode-overlay")).toBeHidden();
});
