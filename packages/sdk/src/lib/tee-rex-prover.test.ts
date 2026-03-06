import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import * as attestationModule from "./attestation.js";
import { type ProverPhase, ProvingMode, TeeRexProver } from "./tee-rex-prover.js";

// --- Test helpers ---

const API_URL = "http://tee-rex-test.invalid:9999";
const ACCELERATOR_PORT = 59833;

const fakeStep = {
  functionName: "test_fn",
  witness: new Map([[0, "val"]]),
  bytecode: new Uint8Array([0, 1]),
  vk: new Uint8Array([2, 3]),
  timings: { witgen: 10 },
} as any;

/**
 * Handler receives the URL string and the original fetch input (may be a
 * `Request` object when called by ky). Read the body from `request` if needed:
 * `await request.text()` when `request` is a Request, or `init?.body` otherwise.
 */
type RouteHandler = (url: string, request: Request | string) => Response | Promise<Response>;

/**
 * Replace `globalThis.fetch` with a route-based mock. Routes are matched by
 * `url.includes(pattern)` in insertion order. Unmatched requests return 404.
 * Returns `fetchedUrls` for assertions on which endpoints were called.
 */
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

/** Mock that rejects every request (simulates no server running). */
function mockFetchOffline(): { fetchedUrls: string[] } {
  const fetchedUrls: string[] = [];

  globalThis.fetch = mock(async (input: any) => {
    const url: string = typeof input === "string" ? input : input.url;
    fetchedUrls.push(url);
    throw new TypeError("fetch failed (connection refused)");
  }) as any;

  return { fetchedUrls };
}

/** Spy on the parent WASM prover and make it reject (bb not available in tests). */
function mockWasmProver() {
  const spy = spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof");
  spy.mockRejectedValue(new Error("local prover not available in test"));
  return spy;
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

  test("can instantiate with correct proving modes", () => {
    const prover = new TeeRexProver("http://localhost:4000", new WASMSimulator());

    expect(prover).toBeDefined();
    prover.setProvingMode(ProvingMode.local);
    prover.setProvingMode(ProvingMode.remote);
    prover.setProvingMode(ProvingMode.accelerated);
  });

  describe("Remote", () => {
    test("calls the API's attestation endpoint", async () => {
      const { fetchedUrls } = mockFetch();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock returns 404
      }

      expect(fetchedUrls.some((url) => url.includes(`${API_URL}/attestation`))).toBe(true);
    });

    test("requireAttestation rejects standard mode servers", async () => {
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);
      prover.setAttestationConfig({ requireAttestation: true });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
    });

    test("nitro mode falls back to server-provided key when node:crypto unavailable", async () => {
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
      prover.setProvingMode(ProvingMode.remote);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(verifySpy).toHaveBeenCalledTimes(1);
      verifySpy.mockRestore();
    });

    test("nitro mode re-throws real verification errors", async () => {
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
      prover.setProvingMode(ProvingMode.remote);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow("PCR0 mismatch");

      verifySpy.mockRestore();
    });
  });

  describe("Local", () => {
    test("calls super.createChonkProof, not the API", async () => {
      const { fetchedUrls } = mockFetch();
      const superSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.local);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — WASM mock throws
      }

      expect(fetchedUrls).toHaveLength(0);
      expect(superSpy).toHaveBeenCalledTimes(1);
      superSpy.mockRestore();
    });
  });

  describe("Accelerated", () => {
    const healthOk: RouteHandler = () => Response.json({ status: "ok" });
    const fakeMsgpack = Buffer.from([0x93, 0x01, 0x02, 0x03]);

    /** Mock serializePrivateExecutionSteps to avoid WASM panic on fake witness data. */
    function mockSerializer() {
      return spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(fakeMsgpack);
    }

    test("calls accelerator health check and /prove endpoint", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(fetchedUrls.some((url) => url.includes(`127.0.0.1:${ACCELERATOR_PORT}/health`))).toBe(
        true,
      );
      expect(fetchedUrls.some((url) => url.includes(`127.0.0.1:${ACCELERATOR_PORT}/prove`))).toBe(
        true,
      );
      expect(fetchedUrls.some((url) => url.includes(API_URL))).toBe(false);
      serializeSpy.mockRestore();
    });

    test("falls back to WASM when accelerator is unavailable", async () => {
      mockFetchOffline();
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      // Falls back to WASM (which rejects in test env — but the point is it's called)
      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      expect(wasmSpy).toHaveBeenCalled();
      wasmSpy.mockRestore();
    });

    test("sends msgpack binary payload to /prove", async () => {
      let capturedContentType: string | null = null;
      let capturedBody: ArrayBuffer | null = null;

      const serializeSpy = mockSerializer();

      mockFetch({
        "/health": healthOk,
        "/prove": async (_url, request) => {
          if (typeof request !== "string") {
            capturedContentType = (request as Request).headers.get("content-type");
            capturedBody = await (request as Request).arrayBuffer();
          }
          return new Response("not found", { status: 404 });
        },
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(serializeSpy).toHaveBeenCalledWith([fakeStep]);
      expect(capturedContentType).toBe("application/octet-stream");
      expect(capturedBody).toBeDefined();
      expect(new Uint8Array(capturedBody!)).toEqual(new Uint8Array(fakeMsgpack));

      serializeSpy.mockRestore();
    });

    test("uses configured port for health check", async () => {
      const customPort = 12345;
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);
      prover.setAcceleratorConfig({ port: customPort });

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(fetchedUrls.some((url) => url.includes(`:${customPort}/health`))).toBe(true);
      expect(fetchedUrls.some((url) => url.includes(`:${ACCELERATOR_PORT}/`))).toBe(false);
      serializeSpy.mockRestore();
    });

    test("fires phase callbacks in order when accelerator is available", async () => {
      const phases: ProverPhase[] = [];
      mockFetch({ "/health": healthOk });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);
      prover.setOnPhase((phase) => phases.push(phase));

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected
      }

      expect(phases).toEqual(["detect", "serialize", "transmit", "proving"]);
      serializeSpy.mockRestore();
    });

    test("fires detect → fallback → proving phases on WASM fallback", async () => {
      const phases: ProverPhase[] = [];
      mockFetchOffline();
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);
      prover.setOnPhase((phase) => phases.push(phase));

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // WASM mock rejects in test env
      }

      expect(phases).toEqual(["detect", "fallback", "proving"]);
      wasmSpy.mockRestore();
    });

    test("does not call remote TEE API or attestation endpoints", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthOk });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected
      }

      expect(fetchedUrls.some((url) => url.includes("/attestation"))).toBe(false);
      expect(fetchedUrls.some((url) => url.includes(API_URL))).toBe(false);
      serializeSpy.mockRestore();
    });
  });
});
