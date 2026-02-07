import { expect, test } from "@playwright/test";

// ── Helpers ──

/** Block all service requests so the app stays in "services unavailable" state. */
async function mockServicesOffline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
  await page.route("http://localhost:4000/**", (route) =>
    route.fulfill({ status: 503, body: "Service Unavailable" }),
  );
}

/** Mock both services as healthy. Wallet init will still fail (no real Aztec node). */
async function mockServicesOnline(page: import("@playwright/test").Page) {
  await page.route("**/aztec/status", (route) => route.fulfill({ status: 200, body: "OK" }));
  await page.route("http://localhost:4000/encryption-public-key", (route) =>
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
  await page.goto("/");

  // Remote mode button is active by default
  const remoteBtn = page.locator("#mode-remote");
  await expect(remoteBtn).toHaveClass(/mode-active/);

  // Local and TEE buttons are not active
  const localBtn = page.locator("#mode-local");
  await expect(localBtn).not.toHaveClass(/mode-active/);
  const teeBtn = page.locator("#mode-tee");
  await expect(teeBtn).not.toHaveClass(/mode-active/);

  // Action buttons are disabled
  await expect(page.locator("#deploy-btn")).toBeDisabled();
  await expect(page.locator("#token-flow-btn")).toBeDisabled();

  // TEE config panel is hidden
  await expect(page.locator("#tee-config")).toHaveClass(/hidden/);
});

test("mode buttons toggle active class", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  // Wait for init to settle
  await expect(page.locator("#log")).toContainText("services");

  // Click Local
  await page.click("#mode-local");
  await expect(page.locator("#mode-local")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-remote")).not.toHaveClass(/mode-active/);
  await expect(page.locator("#mode-tee")).not.toHaveClass(/mode-active/);

  // Click Remote
  await page.click("#mode-remote");
  await expect(page.locator("#mode-remote")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-local")).not.toHaveClass(/mode-active/);

  // Click TEE
  await page.click("#mode-tee");
  await expect(page.locator("#mode-tee")).toHaveClass(/mode-active/);
  await expect(page.locator("#mode-remote")).not.toHaveClass(/mode-active/);
});

test("TEE mode shows tee-config panel, other modes hide it", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  // Click TEE — config panel appears
  await page.click("#mode-tee");
  await expect(page.locator("#tee-config")).not.toHaveClass(/hidden/);

  // Click Remote — config panel hides
  await page.click("#mode-remote");
  await expect(page.locator("#tee-config")).toHaveClass(/hidden/);

  // Click TEE again — config panel appears
  await page.click("#mode-tee");
  await expect(page.locator("#tee-config")).not.toHaveClass(/hidden/);

  // Click Local — config panel hides
  await page.click("#mode-local");
  await expect(page.locator("#tee-config")).toHaveClass(/hidden/);
});

test("TEE Check with mocked nitro response shows green dot", async ({ page }) => {
  await mockServicesOffline(page);

  // Mock the TEE attestation endpoint
  await page.route("http://18.134.13.233:4000/attestation", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "nitro" }),
    }),
  );

  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  // Switch to TEE mode and enter URL
  await page.click("#mode-tee");
  await page.fill("#tee-url", "http://18.134.13.233:4000");
  await page.click("#tee-check-btn");

  // Wait for attestation check to complete
  await expect(page.locator("#tee-attestation-dot")).toHaveClass(/status-online/);
  await expect(page.locator("#tee-attestation-label")).toContainText("nitro");
});

test("TEE Check with unreachable server shows red dot", async ({ page }) => {
  await mockServicesOffline(page);

  // Mock the attestation endpoint as unreachable
  await page.route("http://18.134.13.233:4000/attestation", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );

  await page.goto("/");
  await expect(page.locator("#log")).toContainText("services");

  await page.click("#mode-tee");
  await page.fill("#tee-url", "http://18.134.13.233:4000");
  await page.click("#tee-check-btn");

  await expect(page.locator("#tee-attestation-dot")).toHaveClass(/status-offline/);
  await expect(page.locator("#tee-attestation-label")).toContainText("unreachable");
});

test("service dots show online when both services respond OK", async ({ page }) => {
  await mockServicesOnline(page);

  // Block all further RPC calls so wallet init fails gracefully
  await page.route("**/aztec", (route) => {
    // If it's an RPC-style POST request, let it fail
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: "not a real node" });
    }
    return route.continue();
  });

  await page.goto("/");

  // Both service dots should turn green
  await expect(page.locator("#aztec-status")).toHaveClass(/status-online/);
  await expect(page.locator("#teerex-status")).toHaveClass(/status-online/);
});

test("service dots show offline when services fail", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  // Both service dots should be red
  await expect(page.locator("#aztec-status")).toHaveClass(/status-offline/);
  await expect(page.locator("#teerex-status")).toHaveClass(/status-offline/);
});

test("log panel shows checking services message on load", async ({ page }) => {
  await mockServicesOffline(page);
  await page.goto("/");

  // The init function logs "Checking services..."
  await expect(page.locator("#log")).toContainText("Checking services");
});
