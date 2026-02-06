import { describe, expect, test } from "bun:test";
import { createAttestationService, StandardAttestationService } from "./attestation-service.js";

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

describe("createAttestationService", () => {
  test("creates StandardAttestationService for standard mode", () => {
    const service = createAttestationService("standard");
    expect(service).toBeInstanceOf(StandardAttestationService);
  });

  test("throws for unknown mode", () => {
    expect(() => createAttestationService("unknown" as any)).toThrow("Unknown TEE mode");
  });
});
