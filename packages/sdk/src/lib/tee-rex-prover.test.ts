import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import * as stdlibKernel from "@aztec/stdlib/kernel";
import sdkPkg from "../../package.json" with { type: "json" };
import * as attestationModule from "./attestation.js";
import { ProvingMode, TeeRexProver, type TeeRexProverOptions } from "./tee-rex-prover.js";

const SDK_AZTEC_VERSION = (sdkPkg.dependencies as Record<string, string>)["@aztec/stdlib"];

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

function mockFetchOffline() {
  globalThis.fetch = mock(async () => {
    throw new TypeError("fetch failed (connection refused)");
  }) as any;
}

function mockWasmProver() {
  const spy = spyOn(BBLazyPrivateKernelProver.prototype, "createChonkProof");
  spy.mockRejectedValue(new Error("local prover not available in test"));
  return spy;
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

  describe("Accelerated", () => {
    test("falls back to WASM when accelerator is unavailable", async () => {
      mockFetchOffline();
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      expect(wasmSpy).toHaveBeenCalled();
      wasmSpy.mockRestore();
    });

    test("falls back to WASM with legacy accelerator on version mismatch", async () => {
      mockFetch({
        "/health": () => Response.json({ status: "ok", aztec_version: "0.0.0-fake" }),
      });
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      expect(wasmSpy).toHaveBeenCalled();
      wasmSpy.mockRestore();
    });

    test("multi-version accelerator always proceeds (no WASM fallback on version mismatch)", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: "5.0.0-nightly.20260101",
            available_versions: ["5.0.0-nightly.20260101"],
          }),
      });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

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
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(true);
      expect(status.needsDownload).toBe(false);
      expect(status.acceleratorVersion).toBe(SDK_AZTEC_VERSION);
      expect(status.availableVersions).toEqual([SDK_AZTEC_VERSION, "5.0.0-nightly.20260101"]);
      expect(status.sdkAztecVersion).toBe(SDK_AZTEC_VERSION);
      expect(status.protocol).toBeDefined();
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
    });

    test("returns available: false when fetch fails (connection refused)", async () => {
      mockFetchOffline();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(false);
      expect(status.sdkAztecVersion).toBe(SDK_AZTEC_VERSION);
      expect(status.protocol).toBeUndefined();
    });

    test("returns available: false on legacy version mismatch", async () => {
      mockFetch({
        "/health": () => Response.json({ status: "ok", aztec_version: "0.0.0-fake" }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(false);
      expect(status.acceleratorVersion).toBe("0.0.0-fake");
    });

    test("falls back to HTTPS when HTTP fails (Safari mixed-content)", async () => {
      // Simulate: HTTP fetch throws (mixed-content block), HTTPS succeeds
      globalThis.fetch = mock(async (input: any) => {
        const url: string = typeof input === "string" ? input : input.url;
        if (url.startsWith("http://")) {
          throw new TypeError("fetch failed (mixed content)");
        }
        if (url.includes("/health")) {
          return Response.json({
            status: "ok",
            aztec_version: SDK_AZTEC_VERSION,
            available_versions: [SDK_AZTEC_VERSION],
          });
        }
        return new Response("not found", { status: 404 });
      }) as any;

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(true);
      expect(status.protocol).toBe("https");
    });

    test("returns unavailable when both HTTP and HTTPS fail", async () => {
      mockFetchOffline();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      const status = await prover.checkAcceleratorStatus();

      expect(status.available).toBe(false);
      expect(status.protocol).toBeUndefined();
    });

    test("detected protocol is used for subsequent /prove calls", async () => {
      const { fetchedUrls } = mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: SDK_AZTEC_VERSION,
            available_versions: [SDK_AZTEC_VERSION],
          }),
      });
      const serializeSpy = mockSerializer();

      const prover = new TeeRexProver(API_URL, new WASMSimulator());
      prover.setProvingMode(ProvingMode.accelerated);

      try {
        await prover.createChonkProof([fakeStep]);
      } catch {
        // Expected — mock /prove returns 404
      }

      // The /prove request should use whichever protocol the health check used
      const proveUrls = fetchedUrls.filter((u) => u.includes("/prove"));
      expect(proveUrls.length).toBe(1);
      // Protocol matches whichever responded first (in test, both succeed via mockFetch, so HTTP wins)
      expect(proveUrls[0]).toMatch(/^https?:\/\/127\.0\.0\.1:\d+\/prove$/);
      serializeSpy.mockRestore();
    });

    test("protocol resets after setAcceleratorConfig()", async () => {
      mockFetch({
        "/health": () =>
          Response.json({
            status: "ok",
            aztec_version: SDK_AZTEC_VERSION,
            available_versions: [SDK_AZTEC_VERSION],
          }),
      });

      const prover = new TeeRexProver(API_URL, new WASMSimulator());

      // First check caches the protocol
      const status1 = await prover.checkAcceleratorStatus();
      expect(status1.protocol).toBeDefined();

      // Reset config clears cached protocol
      prover.setAcceleratorConfig({ port: 12345 });

      // Next check re-probes both protocols
      const status2 = await prover.checkAcceleratorStatus();
      expect(status2.protocol).toBeDefined();
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

    test("defaults to accelerated when no apiUrl", async () => {
      mockFetchOffline();
      const wasmSpy = mockWasmProver();

      const prover = new TeeRexProver({ simulator: new WASMSimulator() });

      await expect(prover.createChonkProof([fakeStep])).rejects.toThrow(
        "local prover not available in test",
      );
      // accelerated mode falls back to WASM when offline
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
