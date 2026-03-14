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

  test("includes bbVersions when userData is provided", async () => {
    const service = new StandardAttestationService();
    const versions = [{ version: "1.0.0", sha256: "abc123" }];
    const userData = new TextEncoder().encode(JSON.stringify({ versions }));
    const result = await service.getAttestation("key", userData);

    expect(result.mode).toBe("standard");
    expect(result).toHaveProperty("bbVersions");
    if (result.mode === "standard") {
      expect(result.bbVersions).toEqual(versions);
    }
  });

  test("omits bbVersions when no userData provided", async () => {
    const service = new StandardAttestationService();
    const result = await service.getAttestation("key");

    expect(result).not.toHaveProperty("bbVersions");
  });

  test("omits bbVersions when userData is invalid JSON", async () => {
    const service = new StandardAttestationService();
    const userData = new TextEncoder().encode("not json");
    const result = await service.getAttestation("key", userData);

    expect(result).not.toHaveProperty("bbVersions");
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
