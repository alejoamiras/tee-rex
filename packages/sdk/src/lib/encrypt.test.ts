import { describe, expect, test } from "bun:test";
import * as openpgp from "openpgp";
import { encrypt } from "./encrypt.js";

/** Generate a test keypair. */
async function generateTestKeys() {
  const keys = await openpgp.generateKey({
    type: "curve25519",
    userIDs: [{ name: "Test" }],
  });
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

/** Decrypt data with a private key. */
async function decryptWithKey(data: Uint8Array, privateKeyArmored: string): Promise<Uint8Array> {
  const message = await openpgp.readMessage({ binaryMessage: data });
  const decrypted = await openpgp.decrypt({
    message,
    format: "binary",
    decryptionKeys: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored }),
  });
  return decrypted.data as Uint8Array;
}

describe("encrypt", () => {
  test("produces non-empty output", async () => {
    const { publicKey } = await generateTestKeys();
    const data = new TextEncoder().encode("hello");

    const encrypted = await encrypt({ data, encryptionPublicKey: publicKey });

    expect(encrypted.length).toBeGreaterThan(0);
  });

  test("output differs from input", async () => {
    const { publicKey } = await generateTestKeys();
    const data = new TextEncoder().encode("sensitive data");

    const encrypted = await encrypt({ data, encryptionPublicKey: publicKey });

    expect(encrypted).not.toEqual(data);
  });

  test("roundtrip: encrypt then decrypt preserves data", async () => {
    const { publicKey, privateKey } = await generateTestKeys();
    const original = new TextEncoder().encode("roundtrip test data");

    const encrypted = await encrypt({ data: original, encryptionPublicKey: publicKey });
    const decrypted = await decryptWithKey(encrypted, privateKey);

    expect(decrypted).toEqual(original);
  });

  test("roundtrip works with binary data", async () => {
    const { publicKey, privateKey } = await generateTestKeys();
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      original[i] = i;
    }

    const encrypted = await encrypt({ data: original, encryptionPublicKey: publicKey });
    const decrypted = await decryptWithKey(encrypted, privateKey);

    expect(decrypted).toEqual(original);
  });

  test("throws on invalid public key", async () => {
    const data = new TextEncoder().encode("hello");

    expect(encrypt({ data, encryptionPublicKey: "not-a-key" })).rejects.toThrow();
  });
});
