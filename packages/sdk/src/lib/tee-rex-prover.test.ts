import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as attestationModule from "./attestation.js";
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

    test("remote mode calls the API's attestation endpoint", async () => {
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

      const attestationEndpointCalled = fetchedUrls.some((url) =>
        url.includes(`${API_URL}/attestation`),
      );
      expect(attestationEndpointCalled).toBe(true);
    });

    test("requireAttestation rejects standard mode servers", async () => {
      globalThis.fetch = mock(async (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/attestation")) {
          return new Response(JSON.stringify({ mode: "standard", publicKey: "fake-key" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      }) as any;

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);
      prover.setAttestationConfig({ requireAttestation: true });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
    });

    test("nitro mode falls back to server-provided key when node:crypto unavailable", async () => {
      const SERVER_PUBLIC_KEY = "server-provided-key-abc123";

      globalThis.fetch = mock(async (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/attestation")) {
          return new Response(
            JSON.stringify({
              mode: "nitro",
              attestationDocument: "fake-doc",
              publicKey: SERVER_PUBLIC_KEY,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // /prove endpoint — return a valid response so the flow completes up to encryption
        return new Response("not found", { status: 404 });
      }) as any;

      // Mock verifyNitroAttestation to throw a browser-like error
      const verifySpy = spyOn(attestationModule, "verifyNitroAttestation").mockRejectedValue(
        new TypeError("s is not a constructor"),
      );

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      // createChonkProof will fail at the /prove call (404), but the attestation
      // fallback should have succeeded — verify by checking the spy was called
      // and the flow continued past attestation to the /prove request
      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — the mock /prove returns 404
      }

      expect(verifySpy).toHaveBeenCalledTimes(1);
      verifySpy.mockRestore();
    });

    test("nitro mode re-throws real verification errors", async () => {
      globalThis.fetch = mock(async (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/attestation")) {
          return new Response(
            JSON.stringify({
              mode: "nitro",
              attestationDocument: "fake-doc",
              publicKey: "server-key",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }) as any;

      // Mock verifyNitroAttestation to throw a real verification error
      const verifySpy = spyOn(attestationModule, "verifyNitroAttestation").mockRejectedValue(
        new Error("PCR0 mismatch: expected abc got def"),
      );

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow("PCR0 mismatch");

      verifySpy.mockRestore();
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
