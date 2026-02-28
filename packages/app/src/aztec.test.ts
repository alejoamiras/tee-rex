import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  PROVER_CONFIGURED,
  revertToEmbedded,
  setExternalWallet,
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
  state.wallet = null;
  state.embeddedWallet = null;
  state.walletType = null;
  state.externalProvider = null;
  state.registeredAddresses = [];
  state.selectedAccountIndex = 0;
  state.provingMode = "local";
  state.uiMode = "local";
  state.teeServerUrl = "/tee";
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
});

// ── setExternalWallet / revertToEmbedded ──
describe("setExternalWallet", () => {
  test("switches to external wallet state", () => {
    const mockWallet = { id: "ext" } as any;
    const mockProvider = { name: "Test" } as any;
    const mockAddresses = [{ toString: () => "0x1234" }] as any;

    setExternalWallet(mockWallet, mockProvider, mockAddresses);

    expect(state.wallet).toBe(mockWallet);
    expect(state.walletType).toBe("external");
    expect(state.externalProvider).toBe(mockProvider);
    expect(state.registeredAddresses).toBe(mockAddresses);
  });
});

describe("revertToEmbedded", () => {
  test("restores embedded wallet state", () => {
    const mockEmbedded = { id: "embedded" } as any;
    state.embeddedWallet = mockEmbedded;
    state.wallet = { id: "ext" } as any;
    state.walletType = "external";
    state.externalProvider = { name: "Test" } as any;
    state.selectedAccountIndex = 2;

    revertToEmbedded();

    expect(state.wallet).toBe(mockEmbedded);
    expect(state.walletType).toBe("embedded");
    expect(state.externalProvider).toBeNull();
    expect(state.selectedAccountIndex).toBe(0);
  });

  test("does nothing when embeddedWallet is null", () => {
    state.embeddedWallet = null;
    state.wallet = { id: "ext" } as any;
    state.walletType = "external";

    revertToEmbedded();

    expect(state.wallet).toEqual({ id: "ext" });
    expect(state.walletType).toBe("external");
  });
});
