import { describe, expect, mock, test } from "bun:test";
import * as openpgp from "openpgp";
import { Base64, Bytes } from "ox";
import { type AppDependencies, createApp } from "./index.js";
import { StandardAttestationService } from "./lib/attestation-service.js";
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
  const fakeProof = {
    toBuffer: () => Buffer.from("fake-proof-data"),
  };
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

      // Build a minimal valid payload matching the zod schema
      // witness: mapSchema expects Array<[key, value]> (JSON-serialized Map)
      // bytecode/vk: schemas.Buffer accepts { type: 'Buffer', data: number[] }
      const payload = {
        executionSteps: [
          {
            functionName: "test_function",
            witness: [[0, "value0"]],
            bytecode: { type: "Buffer", data: [0, 1, 2] },
            vk: { type: "Buffer", data: [3, 4, 5] },
            timings: { witgen: 100 },
          },
        ],
      };

      const plaintext = Bytes.fromString(JSON.stringify(payload));
      const encrypted = await encryptForKey(plaintext, publicKey);
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
    } finally {
      close();
    }
  });
});
