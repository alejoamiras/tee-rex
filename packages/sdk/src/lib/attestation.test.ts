import { describe, expect, test } from "bun:test";
import { AttestationError, verifyNitroAttestation } from "./attestation.js";

describe("verifyNitroAttestation", () => {
  test("rejects invalid base64 input", async () => {
    await expect(verifyNitroAttestation("not-valid-base64!!!")).rejects.toThrow();
  });

  test("rejects non-CBOR data", async () => {
    const data = Buffer.from("just plain text").toString("base64");
    await expect(verifyNitroAttestation(data)).rejects.toThrow();
  });

  test("rejects empty CBOR array", async () => {
    const { encode } = await import("cbor-x");
    const data = Buffer.from(encode([])).toString("base64");
    await expect(verifyNitroAttestation(data)).rejects.toThrow(AttestationError);
  });

  test("rejects CBOR array with wrong length", async () => {
    const { encode } = await import("cbor-x");
    const data = Buffer.from(encode([new Uint8Array(), {}, new Uint8Array()])).toString("base64");
    await expect(verifyNitroAttestation(data)).rejects.toThrow("Invalid COSE_Sign1 structure");
  });
});
