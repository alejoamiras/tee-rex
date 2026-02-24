import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import { SgxWorkerClient } from "./sgx-worker-client.js";

/**
 * Create a mock TCP server that speaks the length-prefixed JSON protocol.
 * The handler receives the parsed request and returns a response object.
 *
 * Wire format (both directions): [4-byte big-endian length][JSON payload]
 */
function createMockWorker(
  handler: (request: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let requestLength: number | null = null;

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (requestLength === null && buffer.length >= 4) {
          requestLength = buffer.readUInt32BE(0);
        }

        if (requestLength !== null && buffer.length >= 4 + requestLength) {
          const body = buffer.subarray(4, 4 + requestLength);
          const request = JSON.parse(body.toString()) as Record<string, unknown>;
          const response = handler(request);
          const payload = Buffer.from(JSON.stringify(response));
          const header = Buffer.alloc(4);
          header.writeUInt32BE(payload.length, 0);
          socket.end(Buffer.concat([header, payload]));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

let mockServer: { port: number; close: () => void } | null = null;

afterEach(() => {
  mockServer?.close();
  mockServer = null;
});

describe("SgxWorkerClient", () => {
  describe("getPublicKey", () => {
    test("returns the public key from the worker", async () => {
      mockServer = await createMockWorker((req) => {
        expect(req.action).toBe("get_public_key");
        return {
          publicKey:
            "-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----",
        };
      });

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      const key = await client.getPublicKey();
      expect(key).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    });

    test("throws on missing publicKey in response", async () => {
      mockServer = await createMockWorker(() => ({ unexpected: true }));

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      await expect(client.getPublicKey()).rejects.toThrow("missing publicKey");
    });
  });

  describe("getQuote", () => {
    test("sends userData and returns the quote buffer", async () => {
      const testUserData = Buffer.from("test-user-data-hash");
      const testQuote = Buffer.from("mock-dcap-quote-bytes");

      mockServer = await createMockWorker((req) => {
        expect(req.action).toBe("get_quote");
        expect(Buffer.from(req.userData as string, "base64").toString()).toBe(
          "test-user-data-hash",
        );
        return { quote: testQuote.toString("base64") };
      });

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      const quote = await client.getQuote(testUserData);
      expect(quote).toEqual(testQuote);
    });

    test("throws on missing quote in response", async () => {
      mockServer = await createMockWorker(() => ({}));

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      await expect(client.getQuote(Buffer.from("data"))).rejects.toThrow("missing quote");
    });
  });

  describe("prove", () => {
    test("sends encrypted payload and returns proof buffer", async () => {
      const testPayload = Buffer.from("encrypted-witness-data");
      const testProof = Buffer.from("proof-output-bytes");

      mockServer = await createMockWorker((req) => {
        expect(req.action).toBe("prove");
        expect(Buffer.from(req.encryptedPayload as string, "base64").toString()).toBe(
          "encrypted-witness-data",
        );
        return { proof: testProof.toString("base64") };
      });

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      const proof = await client.prove(testPayload);
      expect(proof).toEqual(testProof);
    });

    test("throws with worker error message when proof fails", async () => {
      mockServer = await createMockWorker(() => ({ error: "decryption failed" }));

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      await expect(client.prove(Buffer.from("bad-data"))).rejects.toThrow(
        "SGX worker error: decryption failed",
      );
    });

    test("throws on missing proof in response", async () => {
      mockServer = await createMockWorker(() => ({ status: "ok" }));

      const client = new SgxWorkerClient("127.0.0.1", mockServer.port);
      await expect(client.prove(Buffer.from("data"))).rejects.toThrow("missing proof");
    });
  });

  describe("connection errors", () => {
    test("throws when worker is unreachable", async () => {
      const client = new SgxWorkerClient("127.0.0.1", 1); // port 1 — unreachable
      await expect(client.getPublicKey()).rejects.toThrow("SGX worker connection failed");
    });
  });
});
