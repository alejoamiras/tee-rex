import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    headless: true,
  },
  webServer: [
    {
      command: "bun run dev",
      port: 5173,
      reuseExistingServer: true,
      env: { PROVER_URL: process.env.PROVER_URL || "http://localhost:4000" },
    },
    {
      command: "bunx vite --port 5174",
      port: 5174,
      reuseExistingServer: true,
      // Explicitly unset — ensures PROVER_CONFIGURED=false & TEE_CONFIGURED=false
      env: { PROVER_URL: "", TEE_URL: "" },
    },
  ],
  projects: [
    {
      name: "mocked",
      testDir: "./e2e",
      testMatch: "*.mocked.spec.ts",
      timeout: 30_000,
      use: { baseURL: "http://localhost:5173" },
    },
    {
      name: "mocked-unconfigured",
      testDir: "./e2e",
      testMatch: "*.mocked-unconfigured.spec.ts",
      timeout: 30_000,
      use: { baseURL: "http://localhost:5174" },
    },
    {
      name: "fullstack",
      testDir: "./e2e",
      testMatch: "*.fullstack.spec.ts",
      timeout: 10 * 60 * 1000,
      retries: 0,
      use: {
        baseURL: "http://localhost:5173",
        actionTimeout: 0,
        trace: "retain-on-failure",
      },
    },
  ],
});
