import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import { ProvingMode, TeeRexProver } from "./tee-rex-prover.js";

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

  describe("createChonkProof routing", () => {
    const API_URL = "http://tee-rex-test.invalid:9999";

    // Minimal fake execution step matching PrivateExecutionStep shape
    const fakeStep = {
      functionName: "test_fn",
      witness: new Map([[0, "val"]]),
      bytecode: new Uint8Array([0, 1]),
      vk: new Uint8Array([2, 3]),
      timings: { witgen: 10 },
    } as any;

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("remote mode calls the API's encryption-public-key endpoint", async () => {
      const fetchedUrls: string[] = [];

      globalThis.fetch = mock(async (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        fetchedUrls.push(url);
        // Return a failure to stop the flow early — we just want to verify the URL
        return new Response("not found", { status: 404 });
      }) as any;

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      // createChonkProof will fail because our mock server returns 404,
      // but we can verify it tried to reach the right endpoint
      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — the mock doesn't return a valid response
      }

      const keyEndpointCalled = fetchedUrls.some((url) =>
        url.includes(`${API_URL}/encryption-public-key`),
      );
      expect(keyEndpointCalled).toBe(true);
    });

    test("local mode calls super.createChonkProof, not the API", async () => {
      let fetchCalled = false;
      globalThis.fetch = mock(async () => {
        fetchCalled = true;
        return new Response("", { status: 500 });
      }) as any;

      const superSpy = spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof");
      superSpy.mockRejectedValue(new Error("local prover not available in test"));

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.local);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — we mocked super to throw
      }

      expect(fetchCalled).toBe(false);
      expect(superSpy).toHaveBeenCalledTimes(1);
      superSpy.mockRestore();
    });
  });
});
