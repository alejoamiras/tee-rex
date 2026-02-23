import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createAttestationService,
  SgxAttestationService,
  StandardAttestationService,
} from "./attestation-service.js";
import type { SgxWorkerClient } from "./sgx-worker-client.js";

describe("StandardAttestationService", () => {
  test("returns standard mode with the provided public key", async () => {
    const service = new StandardAttestationService();
    const result = await service.getAttestation("test-public-key");

    expect(result.mode).toBe("standard");
    expect(result.publicKey).toBe("test-public-key");
  });

  test("does not include attestationDocument in standard mode", async () => {
    const service = new StandardAttestationService();
    const result = await service.getAttestation("key");

    expect(result).not.toHaveProperty("attestationDocument");
  });
});

describe("SgxAttestationService", () => {
  function createMockWorker(overrides?: Partial<SgxWorkerClient>) {
    return {
      getPublicKey: mock(() =>
        Promise.resolve(
          "-----BEGIN PGP PUBLIC KEY BLOCK-----\nsgx-key\n-----END PGP PUBLIC KEY BLOCK-----",
        ),
      ),
      getQuote: mock((_userData: Buffer) => Promise.resolve(Buffer.from("mock-dcap-quote"))),
      prove: mock(() => Promise.resolve(Buffer.from("proof"))),
      ...overrides,
    } as unknown as SgxWorkerClient;
  }

  test("returns sgx mode with quote and public key from worker", async () => {
    const worker = createMockWorker();
    const service = new SgxAttestationService(worker);
    const result = await service.getAttestation("ignored-server-key");

    expect(result.mode).toBe("sgx");
    expect(result.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(result).toHaveProperty("quote");
    if (result.mode === "sgx") {
      expect(Buffer.from(result.quote, "base64").toString()).toBe("mock-dcap-quote");
    }
  });

  test("fetches public key from worker, not from server encryption service", async () => {
    const worker = createMockWorker();
    const service = new SgxAttestationService(worker);
    await service.getAttestation("server-key-should-be-ignored");

    expect(worker.getPublicKey).toHaveBeenCalledTimes(1);
  });

  test("passes SHA-256 hash of public key as quote user data", async () => {
    const workerPublicKey =
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\nsgx-key\n-----END PGP PUBLIC KEY BLOCK-----";
    const expectedHash = createHash("sha256").update(workerPublicKey).digest();
    const worker = createMockWorker();
    const service = new SgxAttestationService(worker);
    await service.getAttestation("ignored");

    expect(worker.getQuote).toHaveBeenCalledTimes(1);
    const calledWith = (worker.getQuote as ReturnType<typeof mock>).mock.calls[0]![0];
    expect(Buffer.from(calledWith)).toEqual(expectedHash);
  });
});

describe("createAttestationService", () => {
  test("creates StandardAttestationService for standard mode", () => {
    const service = createAttestationService("standard");
    expect(service).toBeInstanceOf(StandardAttestationService);
  });

  test("creates SgxAttestationService for sgx mode with worker", () => {
    const worker = {
      getPublicKey: mock(),
      getQuote: mock(),
      prove: mock(),
    } as unknown as SgxWorkerClient;
    const service = createAttestationService("sgx", worker);
    expect(service).toBeInstanceOf(SgxAttestationService);
  });

  test("throws for sgx mode without worker", () => {
    expect(() => createAttestationService("sgx")).toThrow("SGX mode requires an SgxWorkerClient");
  });

  test("throws for unknown mode", () => {
    expect(() => createAttestationService("unknown" as any)).toThrow("Unknown TEE mode");
  });
});
