import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import * as attestationModule from "./attestation.js";
import { ProvingMode, TeeRexProver, type TeeRexProverOptions } from "./tee-rex-prover.js";

// --- Test helpers ---

const API_URL = "http://tee-rex-test.invalid:9999";

const fakeStep = {
  functionName: "test_fn",
  witness: new Map([[0, "val"]]),
  bytecode: new Uint8Array([0, 1]),
  vk: new Uint8Array([2, 3]),
  timings: { witgen: 10 },
} as any;

type RouteHandler = (url: string, request: Request | string) => Response | Promise<Response>;

function mockFetch(routes: Record<string, RouteHandler> = {}): { fetchedUrls: string[] } {
  const fetchedUrls: string[] = [];

  globalThis.fetch = mock(async (input: any, _init?: any) => {
    const url: string = typeof input === "string" ? input : input.url;
    fetchedUrls.push(url);

    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return handler(url, input);
      }
    }
    return new Response("not found", { status: 404 });
  }) as any;

  return { fetchedUrls };
}

function mockSerializer() {
  return spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(
    Buffer.from([0xde, 0xad]),
  );
}

// --- Tests ---

describe("TeeRexProver", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("UEE", () => {
    test("requireAttestation rejects standard mode servers", async () => {
      const serializeSpy = mockSerializer();
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.uee);
      prover.setAttestationConfig({ requireAttestation: true });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
      serializeSpy.mockRestore();
    });

    test("nitro mode falls back to server-provided key when node:crypto unavailable", async () => {
      const serializeSpy = mockSerializer();
      mockFetch({
        "/attestation": () =>
          Response.json({
            mode: "nitro",
            attestationDocument: "fake-doc",
            publicKey: "server-provided-key-abc123",
          }),
      });

      const verifySpy = spyOn(attestationModule, "verifyNitroAttestation").mockRejectedValue(
        new TypeError("s is not a constructor"),
      );

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.uee);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(verifySpy).toHaveBeenCalledTimes(1);
      verifySpy.mockRestore();
      serializeSpy.mockRestore();
    });

    test("nitro mode re-throws real verification errors", async () => {
      const serializeSpy = mockSerializer();
      mockFetch({
        "/attestation": () =>
          Response.json({
            mode: "nitro",
            attestationDocument: "fake-doc",
            publicKey: "server-key",
          }),
      });

      const verifySpy = spyOn(attestationModule, "verifyNitroAttestation").mockRejectedValue(
        new Error("PCR0 mismatch: expected abc got def"),
      );

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.uee);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow("PCR0 mismatch");

      verifySpy.mockRestore();
      serializeSpy.mockRestore();
    });
  });

  describe("options constructor", () => {
    test("defaults to uee when apiUrl is provided without provingMode", async () => {
      const serializeSpy = mockSerializer();
      const { fetchedUrls } = mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver({ apiUrl: API_URL, simulator: new WASMSimulator() });

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(fetchedUrls.some((url) => url.includes(`${API_URL}/attestation`))).toBe(true);
      serializeSpy.mockRestore();
    });

    test("defaults to local when no apiUrl", async () => {
      const wasmSpy = spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof");
      wasmSpy.mockRejectedValue(new Error("local prover not available in test"));

      const prover = new TeeRexProver({ simulator: new WASMSimulator() });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      // local mode calls the WASM prover directly
      expect(wasmSpy).toHaveBeenCalled();
      wasmSpy.mockRestore();
    });

    test("provingMode 'tee' maps to UEE + requireAttestation", async () => {
      const serializeSpy = mockSerializer();
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver({
        provingMode: "tee",
        apiUrl: API_URL,
        attestation: { requireAttestation: true },
        simulator: new WASMSimulator(),
      });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
      serializeSpy.mockRestore();
    });

    test("throws when UEE mode used without apiUrl (runtime check)", async () => {
      const prover = new TeeRexProver({ provingMode: "uee" } as TeeRexProverOptions);
      prover.setApiUrl("");

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "apiUrl is required for UEE proving mode",
      );
    });
  });

  describe("setProvingMode overloads", () => {
    test("setProvingMode('tee') sets UEE + requireAttestation", async () => {
      const serializeSpy = mockSerializer();
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode("tee", {
        apiUrl: API_URL,
        attestation: { requireAttestation: true },
      });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
      serializeSpy.mockRestore();
    });

    test("setProvingMode('uee', { apiUrl }) changes the server URL", async () => {
      const serializeSpy = mockSerializer();
      const newUrl = "http://new-server.invalid:8080";
      const { fetchedUrls } = mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode("uee", { apiUrl: newUrl });

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected
      }

      expect(fetchedUrls.some((url) => url.includes(newUrl))).toBe(true);
      serializeSpy.mockRestore();
    });
  });
});
