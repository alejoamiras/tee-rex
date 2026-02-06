import { beforeAll, describe, expect, test } from "bun:test";

// Patch expect for @aztec/foundation compatibility BEFORE importing @aztec modules
// @aztec/foundation checks if expect.addEqualityTesters exists (vitest API)
if (!(expect as any).addEqualityTesters) {
  (expect as any).addEqualityTesters = () => {};
}

// Also patch globalThis for modules that check there
if ((globalThis as any).expect && !(globalThis as any).expect.addEqualityTesters) {
  (globalThis as any).expect.addEqualityTesters = () => {};
}

// Dynamic imports to control load order
let WASMSimulator: typeof import("@aztec/simulator/client").WASMSimulator;
let TeeRexProver: typeof import("./TeeRexProver.js").TeeRexProver;
let ProvingMode: typeof import("./TeeRexProver.js").ProvingMode;

beforeAll(async () => {
  const simulator = await import("@aztec/simulator/client");
  WASMSimulator = simulator.WASMSimulator;

  const proverModule = await import("./TeeRexProver.js");
  TeeRexProver = proverModule.TeeRexProver;
  ProvingMode = proverModule.ProvingMode;
});

describe("TeeRexProver", () => {
  test("can instantiate with correct proving modes", () => {
    const prover = new TeeRexProver("http://localhost:4000", new WASMSimulator());

    // Default mode should be remote
    expect(prover).toBeDefined();

    // Can set to local mode
    prover.setProvingMode(ProvingMode.local);

    // Can set back to remote mode
    prover.setProvingMode(ProvingMode.remote);
  });
});
