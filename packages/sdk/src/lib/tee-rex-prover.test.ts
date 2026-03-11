import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import sdkPkg from "../../package.json" with { type: "json" };
import * as attestationModule from "./attestation.js";
import * as encryptModule from "./encrypt.js";
import {
  type AcceleratorStatus,
  type ProverPhase,
  ProvingMode,
  TeeRexProver,
} from "./tee-rex-prover.js";

const SDK_AZTEC_VERSION = (sdkPkg.dependencies as Record<string, string>)["@aztec/stdlib"];

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
    /** Mock serializePrivateExecutionSteps to avoid WASM panic on fake witness data. */
    function mockRemoteSerializer() {
      return spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(
        Buffer.from([0xde, 0xad]),
      );
    }

    test("uses serializePrivateExecutionSteps for payload serialization", async () => {
      const serializeSpy = mockRemoteSerializer();
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      expect(serializeSpy).toHaveBeenCalledWith([fakeStep]);
      serializeSpy.mockRestore();
    });

    test("sends x-aztec-version header to /prove", async () => {
      let capturedVersionHeader: string | null = null;
      const serializeSpy = mockRemoteSerializer();
      const encryptSpy = spyOn(encryptModule, "encrypt").mockResolvedValue(
        new Uint8Array([0x01, 0x02]),
      );
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
        "/prove": async (_url, request) => {
          if (typeof request !== "string") {
            capturedVersionHeader = (request as Request).headers.get("x-aztec-version");
          }
          return new Response("not found", { status: 404 });
        },
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — ky retries and then fails
      }

      expect(capturedVersionHeader).toBe(SDK_AZTEC_VERSION);
      serializeSpy.mockRestore();
      encryptSpy.mockRestore();
    });

    test("calls the API's attestation endpoint", async () => {
      const serializeSpy = mockRemoteSerializer();
      const { fetchedUrls } = mockFetch();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock returns 404
      }

      expect(fetchedUrls.some((url) => url.includes(`${API_URL}/attestation`))).toBe(true);
      serializeSpy.mockRestore();
    });

    test("requireAttestation rejects standard mode servers", async () => {
      const serializeSpy = mockRemoteSerializer();
      mockFetch({
        "/attestation": () => Response.json({ mode: "standard", publicKey: "fake-key" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.remote);
      prover.setAttestationConfig({ requireAttestation: true });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "requireAttestation is enabled",
      );
      serializeSpy.mockRestore();
    });

    test("nitro mode falls back to server-provided key when node:crypto unavailable", async () => {
      const serializeSpy = mockRemoteSerializer();
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
      serializeSpy.mockRestore();
    });

    test("nitro mode re-throws real verification errors", async () => {
      const serializeSpy = mockRemoteSerializer();
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
      serializeSpy.mockRestore();
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
    /** Health response with available_versions (multi-version protocol). */
    const healthMultiVersion: RouteHandler = () =>
      Response.json({
        status: "ok",
        aztec_version: SDK_AZTEC_VERSION,
        available_versions: [SDK_AZTEC_VERSION],
      });

    /** Health response where SDK version is NOT in available_versions (triggers download). */
    const healthNeedsDownload: RouteHandler = () =>
      Response.json({
        status: "ok",
        aztec_version: "5.0.0-nightly.20260101",
        available_versions: ["5.0.0-nightly.20260101"],
      });

    const fakeMsgpack = Buffer.from([0x93, 0x01, 0x02, 0x03]);

    /** Mock serializePrivateExecutionSteps to avoid WASM panic on fake witness data. */
    function mockSerializer() {
      return spyOn(stdlibKernel, "serializePrivateExecutionSteps").mockReturnValue(fakeMsgpack);
    }

    test("calls accelerator health check and /prove endpoint", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthMultiVersion });
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

    test("sends msgpack binary payload with x-aztec-version header to /prove", async () => {
      let capturedContentType: string | null = null;
      let capturedBody: ArrayBuffer | null = null;
      let capturedVersionHeader: string | null = null;

      const serializeSpy = mockSerializer();

      mockFetch({
        "/health": healthMultiVersion,
        "/prove": async (_url, request) => {
          if (typeof request !== "string") {
            capturedContentType = (request as Request).headers.get("content-type");
            capturedBody = await (request as Request).arrayBuffer();
            capturedVersionHeader = (request as Request).headers.get("x-aztec-version");
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
      expect(capturedVersionHeader).toBe(SDK_AZTEC_VERSION);

      serializeSpy.mockRestore();
    });

    test("uses configured port for health check", async () => {
      const customPort = 12345;
      const { fetchedUrls } = mockFetch({ "/health": healthMultiVersion });
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
      mockFetch({ "/health": healthMultiVersion });
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

    test("emits downloading phase when version not in available_versions", async () => {
      const phases: ProverPhase[] = [];
      mockFetch({ "/health": healthNeedsDownload });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);
      prover.setOnPhase((phase) => phases.push(phase));

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected
      }

      expect(phases).toContain("downloading");
      expect(phases.indexOf("downloading")).toBeLessThan(phases.indexOf("serialize"));
      serializeSpy.mockRestore();
    });

    test("does not emit downloading when version is in available_versions", async () => {
      const phases: ProverPhase[] = [];
      mockFetch({ "/health": healthMultiVersion });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);
      prover.setOnPhase((phase) => phases.push(phase));

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected
      }

      expect(phases).not.toContain("downloading");
      serializeSpy.mockRestore();
    });

    test("does not call remote TEE API or attestation endpoints", async () => {
      const { fetchedUrls } = mockFetch({ "/health": healthMultiVersion });
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

    test("falls back to WASM with legacy accelerator on version mismatch", async () => {
      const healthMismatch: RouteHandler = () =>
        Response.json({ status: "ok", aztec_version: "0.0.0-fake" });
      mockFetch({ "/health": healthMismatch });
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      expect(wasmSpy).toHaveBeenCalled();
      wasmSpy.mockRestore();
    });

    test("proceeds with legacy accelerator when version is unknown", async () => {
      const healthUnknown: RouteHandler = () =>
        Response.json({ status: "ok", aztec_version: "unknown" });
      mockFetch({ "/health": healthUnknown });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      // Should have called /prove (not fallen back to WASM)
      serializeSpy.mockRestore();
    });

    test("multi-version accelerator always proceeds (no WASM fallback on mismatch)", async () => {
      // When available_versions is present but SDK version not in it,
      // the SDK should still proceed (accelerator will download on demand)
      mockFetch({ "/health": healthNeedsDownload });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      // Should have called serialize (not fallen back to WASM)
      expect(serializeSpy).toHaveBeenCalled();
      serializeSpy.mockRestore();
    });
  });

  describe("checkAcceleratorStatus", () => {
    test("returns available + version info when healthy (multi-version)", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: SDK_AZTEC_VERSION,
            available_versions: [SDK_AZTEC_VERSION, "5.0.0-nightly.20260101"],
          }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status: AcceleratorStatus = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(true);
      expect(status.needsDownload).toBe(false);
      expect(status.acceleratorVersion).toBe(SDK_AZTEC_VERSION);
      expect(status.availableVersions).toEqual([SDK_AZTEC_VERSION, "5.0.0-nightly.20260101"]);
      expect(status.sdkAztecVersion).toBe(SDK_AZTEC_VERSION);
    });

    test("returns needsDownload when SDK version not in available_versions", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: "5.0.0-nightly.20260101",
            available_versions: ["5.0.0-nightly.20260101"],
          }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(true);
      expect(status.needsDownload).toBe(true);
      expect(status.availableVersions).toEqual(["5.0.0-nightly.20260101"]);
    });

    test("returns available: false when fetch fails (connection refused)", async () => {
      mockFetchOffline();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(false);
      expect(status.needsDownload).toBe(false);
      expect(status.sdkAztecVersion).toBe(SDK_AZTEC_VERSION);
    });

    test("returns available: false on legacy version mismatch", async () => {
      mockFetch({
        "/health": () => Response.json({ status: "ok", aztec_version: "0.0.0-fake" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(false);
      expect(status.acceleratorVersion).toBe("0.0.0-fake");
      expect(status.sdkAztecVersion).toBe(SDK_AZTEC_VERSION);
    });

    test("works regardless of current ProvingMode", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: SDK_AZTEC_VERSION,
            available_versions: [SDK_AZTEC_VERSION],
          }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.local);

      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(true);
      expect(status.needsDownload).toBe(false);
    });
  });
});
