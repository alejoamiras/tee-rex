import { describe, expect, test } from "bun:test";
import * as openpgp from "openpgp";
import { EncryptionService } from "./encryption-service.js";

/** Encrypt data using the service's public key (mirrors what the SDK does). */
async function encryptForService(data: Uint8Array, publicKeyArmored: string): Promise<Uint8Array> {
  const message = await openpgp.createMessage({ binary: data });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: await openpgp.readKey({ armoredKey: publicKeyArmored }),
  });
  const unarmored = await openpgp.unarmor(encrypted);
  return unarmored.data as Uint8Array;
}

describe("EncryptionService", () => {
  test("getEncryptionPublicKey returns a valid armored PGP key", async () => {
    const service = new EncryptionService();
    const publicKey = await service.getEncryptionPublicKey();

    expect(publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(publicKey).toContain("-----END PGP PUBLIC KEY BLOCK-----");
  });

  test("getEncryptionPublicKey returns the same key on repeated calls", async () => {
    const service = new EncryptionService();
    const key1 = await service.getEncryptionPublicKey();
    const key2 = await service.getEncryptionPublicKey();

    expect(key1).toBe(key2);
  });

  test("encrypt and decrypt roundtrip preserves data", async () => {
    const service = new EncryptionService();
    const publicKey = await service.getEncryptionPublicKey();

    const original = new TextEncoder().encode("hello tee-rex");
    const encrypted = await encryptForService(original, publicKey);
    const decrypted = await service.decrypt({ data: encrypted });

    expect(decrypted).toEqual(original);
  });

  test("encrypt and decrypt roundtrip works with large payloads", async () => {
    const service = new EncryptionService();
    const publicKey = await service.getEncryptionPublicKey();

    // 100KB of random-ish data
    const original = new Uint8Array(100_000);
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256;
    }

    const encrypted = await encryptForService(original, publicKey);
    const decrypted = await service.decrypt({ data: encrypted });

    expect(decrypted).toEqual(original);
  });

  test("decrypt throws on corrupted input", async () => {
    const service = new EncryptionService();
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);

    expect(service.decrypt({ data: garbage })).rejects.toThrow();
  });
});
