import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnclaveClient } from "./enclave-client.js";

describe("EnclaveClient", () => {
  let mockServer: ReturnType<typeof Bun.serve>;
  let client: EnclaveClient;
  let tmpDir: string;

  // Track requests received by mock server
  let lastRequest: { method: string; path: string; headers: Headers; body?: ArrayBuffer };

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "enclave-client-test-"));
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        lastRequest = {
          method: req.method,
          path: url.pathname,
          headers: req.headers,
          body: req.body ? await req.arrayBuffer() : undefined,
        };

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            versions: [{ version: "1.0.0", sha256: "abc123" }],
          });
        }

        if (url.pathname === "/attestation") {
          return Response.json({
            mode: "standard",
            publicKey: "mock-public-key",
            bbVersions: [{ version: "1.0.0", sha256: "abc123" }],
          });
        }

        if (url.pathname === "/public-key") {
          return Response.json({ publicKey: "mock-public-key" });
        }

        if (url.pathname === "/upload-bb") {
          const version = req.headers.get("x-bb-version");
          return Response.json({ version, sha256: "mock-sha256" });
        }

        if (url.pathname === "/prove") {
          return new Response(JSON.stringify({ proof: "bW9jay1wcm9vZg==" }), {
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

    client = new EnclaveClient(`http://localhost:${mockServer.port}`);
  });

  afterAll(() => {
    mockServer.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("health", () => {
    test("returns health response with versions", async () => {
      const result = await client.health();
      expect(result.status).toBe("ok");
      expect(result.versions).toEqual([{ version: "1.0.0", sha256: "abc123" }]);
    });
  });

  describe("getAttestation", () => {
    test("returns attestation response", async () => {
      const result = await client.getAttestation();
      expect(result.mode).toBe("standard");
      expect(result.publicKey).toBe("mock-public-key");
      expect(result.bbVersions).toEqual([{ version: "1.0.0", sha256: "abc123" }]);
    });
  });

  describe("getPublicKey", () => {
    test("returns public key string", async () => {
      const result = await client.getPublicKey();
      expect(result).toBe("mock-public-key");
    });
  });

  describe("uploadBb", () => {
    test("uploads bb binary and returns version + hash", async () => {
      const bbPath = join(tmpDir, "fake-bb");
      writeFileSync(bbPath, "fake-bb-content");

      const result = await client.uploadBb("2.0.0", bbPath);
      expect(result.version).toBe("2.0.0");
      expect(result.sha256).toBe("mock-sha256");
      expect(lastRequest.headers.get("x-bb-version")).toBe("2.0.0");
    });
  });

  describe("prove", () => {
    test("sends encrypted data and returns proof with timing", async () => {
      const encryptedData = new TextEncoder().encode("encrypted-payload").buffer;
      const result = await client.prove(encryptedData, "1.0.0");

      expect(result.proof).toBe("bW9jay1wcm9vZg==");
      expect(result.proveDurationMs).toBe(100);
      expect(result.decryptDurationMs).toBe(5);
      expect(lastRequest.headers.get("x-aztec-version")).toBe("1.0.0");
    });

    test("omits x-aztec-version header when no version specified", async () => {
      const encryptedData = new TextEncoder().encode("data").buffer;
      await client.prove(encryptedData);

      expect(lastRequest.headers.get("x-aztec-version")).toBeNull();
    });
  });

  describe("error handling", () => {
    test("throws on non-200 health response", async () => {
      const badClient = new EnclaveClient("http://localhost:1"); // nothing listening
      await expect(badClient.health()).rejects.toThrow();
    });
  });
});
