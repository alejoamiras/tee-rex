import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: {
    command: "bun run dev",
    port: 5173,
    reuseExistingServer: true,
    env: { PROVER_URL: process.env.PROVER_URL || "http://localhost:4000" },
  },
  projects: [
    {
      name: "mocked",
      testDir: "./e2e",
      testMatch: "*.mocked.spec.ts",
      timeout: 30_000,
    },
    {
      name: "fullstack",
      testDir: "./e2e",
      testMatch: "*.fullstack.spec.ts",
      timeout: 10 * 60 * 1000,
      retries: 0,
      use: {
        actionTimeout: 0,
        trace: "retain-on-failure",
      },
    },
  ],
});
