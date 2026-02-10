import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { checkAztecNode, checkTeeAttestation, checkTeeRexServer, setUiMode, state } from "./aztec";

// ── fetch mocking ──
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Reset state
  state.prover = null;
  state.provingMode = "remote";
  state.uiMode = "remote";
  state.teeServerUrl = "";
  state.isLiveNetwork = false;
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
    state.teeServerUrl = "";
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
    expect(mockSetApiUrl).toHaveBeenCalledWith("http://localhost:4000");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({});
  });

  test("remote mode sets correct state and prover config", () => {
    setUiMode("remote");
    expect(state.uiMode).toBe("remote");
    expect(state.provingMode).toBe("remote");
    expect(mockSetProvingMode).toHaveBeenCalledWith("remote");
    expect(mockSetApiUrl).toHaveBeenCalledWith("http://localhost:4000");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({});
  });

  test("tee mode sets remote proving with custom URL and attestation", () => {
    setUiMode("tee", "https://tee.example.com:4000");
    expect(state.uiMode).toBe("tee");
    expect(state.provingMode).toBe("remote");
    expect(state.teeServerUrl).toBe("https://tee.example.com:4000");
    expect(mockSetProvingMode).toHaveBeenCalledWith("remote");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://tee.example.com:4000");
    expect(mockSetAttestationConfig).toHaveBeenCalledWith({ requireAttestation: true });
  });

  test("tee mode without URL uses existing teeServerUrl", () => {
    state.teeServerUrl = "https://existing.example.com";
    setUiMode("tee");
    expect(mockSetApiUrl).toHaveBeenCalledWith("https://existing.example.com");
  });
});
