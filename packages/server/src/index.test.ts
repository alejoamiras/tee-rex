import { describe, expect, mock, test } from "bun:test";
import * as openpgp from "openpgp";
import { Base64, Bytes } from "ox";
import { type AppDependencies, createApp } from "./index.js";
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
  const fakeProof = {
    toBuffer: () => Buffer.from("fake-proof-data"),
  };
  const prover = {
    createChonkProof: mock(() => Promise.resolve(fakeProof)),
  };
  const deps = { prover, encryption } as unknown as AppDependencies;
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

describe("GET /encryption-public-key", () => {
  test("returns 200 with a valid PGP public key", async () => {
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
