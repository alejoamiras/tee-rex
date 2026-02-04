import { WASMSimulator } from "@aztec/simulator/client";
import { describe, expect, test } from "vitest";
import { ProvingMode, TeeRexProver } from "./TeeRexProver.js";

describe(TeeRexProver, () => {
  test("can instantiate with correct proving modes", () => {
    const prover = new TeeRexProver(
      "http://localhost:4000",
      new WASMSimulator(),
    );

    // Default mode should be remote
    expect(prover).toBeDefined();

    // Can set to local mode
    prover.setProvingMode(ProvingMode.local);

    // Can set back to remote mode
    prover.setProvingMode(ProvingMode.remote);
  });
});
