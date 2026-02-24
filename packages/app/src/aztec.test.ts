import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  PROVER_CONFIGURED,
  SGX_CONFIGURED,
  SGX_DISPLAY_URL,
  setUiMode,
  state,
  TEE_CONFIGURED,
  TEE_DISPLAY_URL,
} from "./aztec";

// ── fetch mocking ──
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Reset state
  state.prover = null;
  state.provingMode = "local";
  state.uiMode = "local";
  state.teeServerUrl = "/tee";
  state.sgxServerUrl = "/sgx";
  state.proofsRequired = false;
  state.feePaymentMethod = undefined;
});

// ── checkAztecNode ──
describe("checkAztecNode", () => {
  test("returns true when status responds 200", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("OK", { status: 200 })));
    expect(await checkAztecNode()).toBe(true);
  });

  test("returns false when status responds 500", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("", { status: 500 })));
    expect(await checkAztecNode()).toBe(false);
  });

  test("returns false when fetch throws", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error")));
    expect(await checkAztecNode()).toBe(false);
  });
});

// ── checkTeeRexServer ──
describe("checkTeeRexServer", () => {
  test("returns true with valid publicKey", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ publicKey: "abc123" }), { status: 200 })),
    );
    expect(await checkTeeRexServer()).toBe(true);
  });

  test("returns false on non-ok status", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("", { status: 500 })));
    expect(await checkTeeRexServer()).toBe(false);
  });

  test("returns false when publicKey is missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ other: "data" }), { status: 200 })),
    );
    expect(await checkTeeRexServer()).toBe(false);
  });

  test("returns false when fetch throws", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error")));
    expect(await checkTeeRexServer()).toBe(false);
  });
});

// ── checkTeeAttestation ──
describe("checkTeeAttestation", () => {
  test("returns reachable=true and mode=nitro", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ mode: "nitro" }), { status: 200 })),
    );
    expect(await checkTeeAttestation("http://tee.local:4000")).toEqual({
      reachable: true,
      mode: "nitro",
    });
  });

  test("returns reachable=true and mode=sgx", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ mode: "sgx" }), { status: 200 })),
    );
    expect(await checkTeeAttestation("http://sgx.local:4000")).toEqual({
      reachable: true,
      mode: "sgx",
    });
  });

  test("returns reachable=true and mode=standard", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ mode: "standard" }), { status: 200 })),
    );
    expect(await checkTeeAttestation("http://tee.local:4000")).toEqual({
      reachable: true,
      mode: "standard",
    });
  });

  test("returns mode=null when mode field is missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    expect(await checkTeeAttestation("http://tee.local:4000")).toEqual({
      reachable: true,
      mode: null,
    });
  });

  test("returns reachable=false on error status", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response("", { status: 404 })));
    expect(await checkTeeAttestation("http://tee.local:4000")).toEqual({
      reachable: false,
      mode: null,
    });
  });

  test("returns reachable=false when fetch throws", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("timeout")));
    expect(await checkTeeAttestation("http://tee.local:4000")).toEqual({
      reachable: false,
      mode: null,
    });
  });
});

// ── setUiMode ──
describe("setUiMode", () => {
  const mockSetProvingMode = mock();
  const mockSetApiUrl = mock();
  const mockSetAttestationConfig = mock();

  beforeEach(() => {
    mockSetProvingMode.mockClear();
    mockSetApiUrl.mockClear();
    mockSetAttestationConfig.mockClear();
    state.prover = {
      setProvingMode: mockSetProvingMode,
      setApiUrl: mockSetApiUrl,
      setAttestationConfig: mockSetAttestationConfig,
    } as any;
    state.provingMode = "remote";
    state.uiMode = "remote";
    state.teeServerUrl = "/tee";
  });

  test("does nothing when prover is null", () => {
    state.prover = null;
    setUiMode("local");
    expect(state.uiMode).toBe("local");
    expect(mockSetProvingMode).not.toHaveBeenCalled();
  });

  test("local mode sets correct state and prover config", () => {
    setUiMode("local");
    expect(state.uiMode).toBe("local");
    expect(state.provingMode).toBe("local");
    expect(mockSetProvingMode).toHaveBeenCalledWith("local");
    expect(mockSetApiUrl).toHaveBeenCalledWith("/prover");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({});
  });

  test("remote mode sets correct state and prover config", () => {
    setUiMode("remote");
    expect(state.uiMode).toBe("remote");
    expect(state.provingMode).toBe("remote");
    expect(mockSetProvingMode).toHaveBeenCalledWith("remote");
    expect(mockSetApiUrl).toHaveBeenCalledWith("/prover");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({});
  });

  test("nitro mode sets remote proving with custom URL and attestation", () => {
    setUiMode("nitro", "https://tee.example.com:4000");
    expect(state.uiMode).toBe("nitro");
    expect(state.provingMode).toBe("remote");
    expect(state.teeServerUrl).toBe("https://tee.example.com:4000");
    expect(mockSetProvingMode).toHaveBeenCalledWith("remote");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://tee.example.com:4000");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({ requireAttestation: true });
  });

  test("nitro mode without URL uses existing teeServerUrl", () => {
    state.teeServerUrl = "https://existing.example.com";
    setUiMode("nitro");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://existing.example.com");
  });

  test("sgx mode sets remote proving with custom URL and attestation + maaEndpoint", () => {
    setUiMode("sgx", "https://sgx.example.com:4000");
    expect(state.uiMode).toBe("sgx");
    expect(state.provingMode).toBe("remote");
    expect(state.sgxServerUrl).toBe("https://sgx.example.com:4000");
    expect(mockSetProvingMode).toHaveBeenCalledWith("remote");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://sgx.example.com:4000");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({
      requireAttestation: true,
      maaEndpoint: "/maa",
    });
  });

  test("sgx mode without URL uses existing sgxServerUrl", () => {
    state.sgxServerUrl = "https://existing-sgx.example.com";
    setUiMode("sgx");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://existing-sgx.example.com");
  });
});

// ── env-var-driven feature flags ──
// These constants are derived from process.env at module load time.
// In the Vite build, process.env is replaced by the `define` plugin.
// In bun test, they read actual env vars — so test values match the test environment.
describe("feature flags", () => {
  test("PROVER_CONFIGURED reflects process.env.PROVER_URL truthiness", () => {
    expect(PROVER_CONFIGURED).toBe(!!process.env.PROVER_URL);
  });

  test("TEE_CONFIGURED reflects process.env.TEE_URL truthiness", () => {
    expect(TEE_CONFIGURED).toBe(!!process.env.TEE_URL);
  });

  test("TEE_DISPLAY_URL falls back to empty string when TEE_URL not set", () => {
    expect(TEE_DISPLAY_URL).toBe(process.env.TEE_URL || "");
  });

  test("PROVER_CONFIGURED is false when PROVER_URL is empty string", () => {
    // In test env, PROVER_URL is typically unset.
    // The constant uses !!process.env.PROVER_URL which is false for "" and undefined.
    if (!process.env.PROVER_URL) {
      expect(PROVER_CONFIGURED).toBe(false);
    }
  });

  test("TEE_CONFIGURED is false when TEE_URL is empty string", () => {
    if (!process.env.TEE_URL) {
      expect(TEE_CONFIGURED).toBe(false);
    }
  });

  test("SGX_CONFIGURED reflects process.env.SGX_URL truthiness", () => {
    expect(SGX_CONFIGURED).toBe(!!process.env.SGX_URL);
  });

  test("SGX_DISPLAY_URL falls back to empty string when SGX_URL not set", () => {
    expect(SGX_DISPLAY_URL).toBe(process.env.SGX_URL || "");
  });

  test("SGX_CONFIGURED is false when SGX_URL is empty string", () => {
    if (!process.env.SGX_URL) {
      expect(SGX_CONFIGURED).toBe(false);
    }
  });
});
