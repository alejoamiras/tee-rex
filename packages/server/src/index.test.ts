import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as openpgp from "openpgp";
import { Base64 } from "ox";
import { type AppDependencies, type AppMode, createApp } from "./index.js";
import { StandardAttestationService } from "./lib/attestation-service.js";
import { EnclaveClient } from "./lib/enclave-client.js";
import { EncryptionService } from "./lib/encryption-service.js";

/** Encrypt data using a public key (mirrors what the SDK does). */
async function encryptForKey(data: Uint8Array, publicKeyArmored: string): Promise<Uint8Array> {
  const message = await openpgp.createMessage({ binary: data });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: await openpgp.readKey({ armoredKey: publicKeyArmored }),
  });
  const unarmored = await openpgp.unarmor(encrypted);
  return unarmored.data as Uint8Array;
}

/** Create a test app with a mocked ProverService. */
function createTestApp() {
  const encryption = new EncryptionService();
  const attestation = new StandardAttestationService();
  const fakeProof = Buffer.from("fake-proof-data");
  const prover = {
    createChonkProof: mock(() => Promise.resolve(fakeProof)),
  };
  const deps = { prover, encryption, attestation } as unknown as AppDependencies;
  const app = createApp(deps);
  return { app, prover, encryption };
}

/** Start the app on a random port and return the base URL. */
async function startTestServer(app: ReturnType<typeof createApp>) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://localhost:${port}`,
        close: () => server.close(),
      });
    });
  });
}

describe("GET /attestation", () => {
  test("returns standard attestation with public key", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/attestation`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { mode: string; publicKey: string };
      expect(body.mode).toBe("standard");
      expect(body.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    } finally {
      close();
    }
  });
});

describe("X-Request-Id", () => {
  test("generates a request ID when none provided", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/attestation`);
      const requestId = res.headers.get("x-request-id");
      expect(requestId).toBeDefined();
      expect(requestId).toMatch(/^[0-9a-f]{8}-/);
    } finally {
      close();
    }
  });

  test("echoes client-provided request ID", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/attestation`, {
        headers: { "X-Request-Id": "client-123" },
      });
      expect(res.headers.get("x-request-id")).toBe("client-123");
    } finally {
      close();
    }
  });

  test("includes requestId in error responses", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { error: string; requestId: string };
      expect(body.requestId).toBeDefined();
      expect(res.headers.get("x-request-id")).toBe(body.requestId);
    } finally {
      close();
    }
  });
});

describe("GET /encryption-public-key", () => {
  test("returns 200 with a valid PGP public key (backward compat)", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/encryption-public-key`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { publicKey: string };
      expect(body.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    } finally {
      close();
    }
  });
});

describe("Reverse proxy headers", () => {
  test("rate-limited endpoint handles X-Forwarded-For without crashing", async () => {
    // Without trust proxy configured, express-rate-limit v8 throws
    // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR when it sees this header.
    // CloudFront always adds it, so every proxied request would crash.
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "1.2.3.4, 5.6.7.8",
        },
        body: JSON.stringify({ data: "test" }),
      });
      // Should get 400 (bad decryption), not 500 from rate limiter crash
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });
});

describe("Rate limit localhost exemption", () => {
  test("localhost requests bypass the rate limit", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      // Send 12 requests (exceeds the 10/hour limit) — all should get 400
      // (bad payload), not 429 (rate limited), because localhost is exempt.
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${url}/prove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: "not-encrypted" }),
        });
        expect(res.status).toBe(400);
      }
    } finally {
      close();
    }
  });
});

describe("POST /prove — payload limits", () => {
  test("accepts large payloads within the 50mb limit", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      // 15MB payload — should reach the decrypt step (400), not be rejected as too large (413)
      const largeData = "x".repeat(15 * 1024 * 1024);
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: largeData }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Failed to decrypt");
    } finally {
      close();
    }
  });

  test("returns 413 with requestId for payloads exceeding 50mb", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const hugeData = "x".repeat(51 * 1024 * 1024);
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: hugeData }),
      });
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: string; requestId: string };
      expect(body.error).toBe("Request payload too large");
      expect(body.requestId).toBeDefined();
      expect(res.headers.get("x-request-id")).toBe(body.requestId);
    } finally {
      close();
    }
  });
});

describe("POST /prove — error handling", () => {
  test("returns 400 for missing body", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid request body");
    } finally {
      close();
    }
  });

  test("returns 400 for malformed JSON", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Malformed request body");
    } finally {
      close();
    }
  });

  test("includes requestId in malformed JSON error response", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const body = (await res.json()) as { error: string; requestId: string };
      expect(body.requestId).toBeDefined();
      expect(res.headers.get("x-request-id")).toBe(body.requestId);
    } finally {
      close();
    }
  });
});

describe("POST /prove", () => {
  test("returns 200 with proof for valid encrypted payload", async () => {
    const { app, prover, encryption } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const publicKey = await encryption.getEncryptionPublicKey();

      // Simulate msgpack-encoded execution steps (from serializePrivateExecutionSteps)
      const fakeMsgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(fakeMsgpack, publicKey);
      const encryptedBase64 = Base64.fromBytes(encrypted);

      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: encryptedBase64 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      expect(body.proof).toBeDefined();
      expect(typeof body.proof).toBe("string");
      expect(prover.createChonkProof).toHaveBeenCalledTimes(1);

      // Verify the prover received the raw msgpack bytes, not parsed JSON
      const calledWith = (prover.createChonkProof as any).mock.calls[0][0] as Uint8Array;
      expect(new Uint8Array(calledWith)).toEqual(fakeMsgpack);
    } finally {
      close();
    }
  });

  test("passes x-aztec-version header to prover", async () => {
    const { app, prover, encryption } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const publicKey = await encryption.getEncryptionPublicKey();
      const fakeMsgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(fakeMsgpack, publicKey);
      const encryptedBase64 = Base64.fromBytes(encrypted);

      await fetch(`${url}/prove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aztec-version": "5.0.0-nightly.20260309",
        },
        body: JSON.stringify({ data: encryptedBase64 }),
      });

      expect(prover.createChonkProof).toHaveBeenCalledTimes(1);
      const calledVersion = (prover.createChonkProof as any).mock.calls[0][1] as string;
      expect(calledVersion).toBe("5.0.0-nightly.20260309");
    } finally {
      close();
    }
  });
});

describe("GET /health", () => {
  test("returns status, api_version, and available versions", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        api_version: number;
        available_versions: string[];
      };
      expect(body.status).toBe("ok");
      expect(body.api_version).toBe(1);
      expect(Array.isArray(body.available_versions)).toBe(true);
    } finally {
      close();
    }
  });

  test("returns runtime diagnostics", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`);
      const body = (await res.json()) as {
        runtime: {
          hardware_concurrency: string;
          available_parallelism: number;
          cpu_count: number;
          tee_mode: string;
          crs_path: string;
        };
      };
      expect(body.runtime).toBeDefined();
      expect(typeof body.runtime.available_parallelism).toBe("number");
      expect(body.runtime.available_parallelism).toBeGreaterThan(0);
      expect(typeof body.runtime.cpu_count).toBe("number");
      expect(body.runtime.cpu_count).toBeGreaterThan(0);
      expect(typeof body.runtime.tee_mode).toBe("string");
    } finally {
      close();
    }
  });
});

describe("POST /prove — timing headers", () => {
  test("returns x-prove-duration-ms and x-decrypt-duration-ms headers", async () => {
    const { app, encryption } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const publicKey = await encryption.getEncryptionPublicKey();
      const fakeMsgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(fakeMsgpack, publicKey);
      const encryptedBase64 = Base64.fromBytes(encrypted);

      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: encryptedBase64 }),
      });

      expect(res.status).toBe(200);
      const proveDuration = res.headers.get("x-prove-duration-ms");
      const decryptDuration = res.headers.get("x-decrypt-duration-ms");
      expect(proveDuration).toBeDefined();
      expect(decryptDuration).toBeDefined();
      expect(Number(proveDuration)).toBeGreaterThanOrEqual(0);
      expect(Number(decryptDuration)).toBeGreaterThanOrEqual(0);
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// Proxy mode tests
// ---------------------------------------------------------------------------

describe("Proxy mode", () => {
  let mockEnclave: ReturnType<typeof Bun.serve>;
  let enclavePort: number;

  beforeAll(() => {
    mockEnclave = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            versions: [{ version: "1.0.0", sha256: "abc123" }],
          });
        }

        if (url.pathname === "/attestation") {
          return Response.json({
            mode: "standard",
            publicKey: "mock-enclave-public-key",
            bbVersions: [{ version: "1.0.0", sha256: "abc123" }],
          });
        }

        if (url.pathname === "/public-key") {
          return Response.json({ publicKey: "mock-enclave-public-key" });
        }

        if (url.pathname === "/prove") {
          return new Response(JSON.stringify({ proof: "cHJveHktcHJvb2Y=" }), {
            headers: {
              "Content-Type": "application/json",
              "x-prove-duration-ms": "200",
              "x-decrypt-duration-ms": "10",
            },
          });
        }

        if (url.pathname === "/upload-bb") {
          const version = req.headers.get("x-bb-version");
          return Response.json({ version, sha256: "mock-sha256" });
        }

        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    enclavePort = mockEnclave.port!;
  });

  afterAll(() => {
    mockEnclave.stop();
  });

  function createProxyApp() {
    const mode: AppMode = {
      type: "proxy",
      enclaveClient: new EnclaveClient(`http://localhost:${enclavePort}`),
    };
    return createApp(mode);
  }

  test("GET /health proxies to enclave and includes api_version", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        api_version: number;
        available_versions: string[];
        bb_hashes: { version: string; sha256: string }[];
        runtime: Record<string, unknown>;
      };
      expect(body.status).toBe("ok");
      expect(body.api_version).toBe(1);
      expect(body.available_versions).toEqual(["1.0.0"]);
      expect(body.bb_hashes).toEqual([{ version: "1.0.0", sha256: "abc123" }]);
      expect((body as Record<string, unknown>).enclave).toBe("ok");
      expect(body.runtime).toBeDefined();
    } finally {
      close();
    }
  });

  test("GET /health returns ok with empty versions when enclave is unreachable", async () => {
    // Point to a port with nothing listening
    const app = createApp({
      type: "proxy",
      enclaveClient: new EnclaveClient("http://localhost:1"),
    });
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.api_version).toBe(1);
      expect(body.available_versions).toEqual([]);
      expect(body.bb_hashes).toEqual([]);
      expect(body.enclave).toBe("unreachable");
    } finally {
      close();
    }
  });

  test("GET /attestation proxies to enclave", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/attestation`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { mode: string; publicKey: string };
      expect(body.mode).toBe("standard");
      expect(body.publicKey).toBe("mock-enclave-public-key");
    } finally {
      close();
    }
  });

  test("GET /encryption-public-key proxies to enclave", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/encryption-public-key`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { publicKey: string };
      expect(body.publicKey).toBe("mock-enclave-public-key");
    } finally {
      close();
    }
  });

  test("POST /prove proxies to enclave with timing headers", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "dGVzdA==" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      expect(body.proof).toBe("cHJveHktcHJvb2Y=");
      expect(res.headers.get("x-prove-duration-ms")).toBe("200");
      expect(res.headers.get("x-decrypt-duration-ms")).toBe("10");
    } finally {
      close();
    }
  });

  test("POST /prove returns 400 for missing body in proxy mode", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid request body");
    } finally {
      close();
    }
  });

  test("proxy mode preserves X-Request-Id", async () => {
    const app = createProxyApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`, {
        headers: { "X-Request-Id": "proxy-test-123" },
      });
      expect(res.headers.get("x-request-id")).toBe("proxy-test-123");
    } finally {
      close();
    }
  });

  test("POST /prove downloads and uploads bb when version not in enclave", async () => {
    // Stateful mock enclave: starts with no versions, accepts upload, then reports version
    const uploadedVersions = new Set<string>();
    const statefulEnclave = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/health") {
          const versions = [...uploadedVersions].map((v) => ({ version: v, sha256: "mock-sha" }));
          return Response.json({ status: "ok", versions });
        }

        if (url.pathname === "/upload-bb") {
          const version = req.headers.get("x-bb-version");
          if (version) uploadedVersions.add(version);
          return Response.json({ version, sha256: "mock-sha" });
        }

        if (url.pathname === "/prove") {
          return new Response(JSON.stringify({ proof: "cHJvb2Y=" }), {
            headers: {
              "Content-Type": "application/json",
              "x-prove-duration-ms": "100",
              "x-decrypt-duration-ms": "5",
            },
          });
        }

        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });

    // Pre-seed bb binary in version cache so downloadBb() skips the actual HTTP download
    const testVersion = "99.0.0-test.proxy-download";
    const bbDir = join(
      process.env.BB_VERSIONS_DIR || `${process.env.HOME}/.tee-rex/versions`,
      testVersion,
    );
    mkdirSync(bbDir, { recursive: true });
    writeFileSync(join(bbDir, "bb"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const mode: AppMode = {
      type: "proxy",
      enclaveClient: new EnclaveClient(`http://localhost:${statefulEnclave.port}`),
    };
    const app = createApp(mode);
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aztec-version": testVersion,
        },
        body: JSON.stringify({ data: "dGVzdA==" }),
      });

      expect(res.status).toBe(200);
      // Verify download+upload occurred (timing headers set)
      expect(res.headers.get("x-download-duration-ms")).toBeDefined();
      expect(res.headers.get("x-upload-duration-ms")).toBeDefined();
      expect(Number(res.headers.get("x-download-duration-ms"))).toBeGreaterThanOrEqual(0);
      expect(Number(res.headers.get("x-upload-duration-ms"))).toBeGreaterThanOrEqual(0);
      // Verify proof returned
      const body = (await res.json()) as { proof: string };
      expect(body.proof).toBe("cHJvb2Y=");
      // Verify bb was uploaded to enclave
      expect(uploadedVersions.has(testVersion)).toBe(true);
    } finally {
      close();
      statefulEnclave.stop();
      rmSync(bbDir, { recursive: true, force: true });
    }
  });
});
