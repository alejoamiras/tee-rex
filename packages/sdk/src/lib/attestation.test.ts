import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { AttestationError, AttestationErrorCode, verifyNitroAttestation } from "./attestation.js";

/**
 * Generate a P-384 EC key pair and self-signed or CA-signed X.509 certificate
 * using the openssl CLI. Returns PEM strings and DER bytes.
 */
function generateCert(opts: {
  subject: string;
  issuerKey?: string;
  issuerCert?: string;
  ca?: boolean;
  days?: number;
}): { keyPem: string; certPem: string; certDer: Uint8Array } {
  const { subject, issuerKey, issuerCert, ca = false, days = 365 } = opts;

  // Generate EC P-384 private key
  const keyPem = execSync("openssl ecparam -genkey -name secp384r1 -noout 2>/dev/null", {
    encoding: "utf-8",
  });

  if (issuerKey && issuerCert) {
    // Create a CSR then sign with issuer
    const csrPem = execSync(
      `echo "${keyPem}" | openssl req -new -key /dev/stdin -subj "${subject}" 2>/dev/null`,
      { encoding: "utf-8" },
    );

    // Write temp files for openssl x509 -req
    const tmpKey = `/tmp/test-issuer-key-${Date.now()}.pem`;
    const tmpCert = `/tmp/test-issuer-cert-${Date.now()}.pem`;
    const tmpCsr = `/tmp/test-csr-${Date.now()}.pem`;
    execSync(`cat > ${tmpKey} << 'ENDKEY'\n${issuerKey}\nENDKEY`);
    execSync(`cat > ${tmpCert} << 'ENDCERT'\n${issuerCert}\nENDCERT`);
    execSync(`cat > ${tmpCsr} << 'ENDCSR'\n${csrPem}\nENDCSR`);

    let cmd = `openssl x509 -req -in ${tmpCsr} -CA ${tmpCert} -CAkey ${tmpKey} -CAcreateserial -days ${days} -sha384`;
    if (ca) {
      cmd += ` -extfile <(echo "basicConstraints=critical,CA:TRUE")`;
    }
    const certPem = execSync(`bash -c '${cmd} 2>/dev/null'`, { encoding: "utf-8" });

    // Cleanup
    execSync(`rm -f ${tmpKey} ${tmpCert} ${tmpCsr} ${tmpCert.replace(".pem", ".srl")}`);

    const certDer = execSync(`echo "${certPem}" | openssl x509 -outform DER 2>/dev/null`);

    return { keyPem, certPem, certDer: new Uint8Array(certDer) };
  }

  // Self-signed
  let cmd = `echo "${keyPem}" | openssl req -new -x509 -key /dev/stdin -subj "${subject}" -days ${days} -sha384`;
  if (ca) {
    cmd += ` -addext "basicConstraints=critical,CA:TRUE"`;
  }
  const certPem = execSync(`bash -c '${cmd} 2>/dev/null'`, { encoding: "utf-8" });
  const certDer = execSync(`echo "${certPem}" | openssl x509 -outform DER 2>/dev/null`);

  return { keyPem, certPem, certDer: new Uint8Array(certDer) };
}

/**
 * Build a synthetic Nitro-style attestation document for testing.
 *
 * Creates a 3-cert chain (root → intermediate → leaf), builds a CBOR attestation
 * payload, and wraps it in a COSE_Sign1 envelope signed by the leaf key.
 */
async function buildTestAttestation(
  overrides: {
    publicKey?: string;
    nonce?: string;
    pcrs?: Record<number, string>;
    timestamp?: number;
  } = {},
) {
  const { encode: encodeCbor } = await import("cbor-x");

  // Generate certificate chain: root → intermediate → leaf (all P-384)
  const root = generateCert({ subject: "/CN=Test Root CA", ca: true });
  const intermediate = generateCert({
    subject: "/CN=Test Intermediate",
    issuerKey: root.keyPem,
    issuerCert: root.certPem,
    ca: true,
  });
  const leaf = generateCert({
    subject: "/CN=Test Leaf",
    issuerKey: intermediate.keyPem,
    issuerCert: intermediate.certPem,
  });

  // Build PCR map
  const pcrs = new Map<number, Uint8Array>();
  if (overrides.pcrs) {
    for (const [index, hex] of Object.entries(overrides.pcrs)) {
      pcrs.set(Number(index), Buffer.from(hex, "hex"));
    }
  } else {
    pcrs.set(0, new Uint8Array(48));
  }

  const embeddedPublicKey = overrides.publicKey ?? "test-public-key-pem";
  const timestamp = overrides.timestamp ?? Date.now();

  // Build the attestation document payload
  const attestationPayload: Record<string, unknown> = {
    module_id: "test-module-id",
    timestamp,
    digest: "SHA384",
    pcrs,
    certificate: leaf.certDer,
    cabundle: [root.certDer, intermediate.certDer],
    public_key: new TextEncoder().encode(embeddedPublicKey),
  };

  if (overrides.nonce) {
    attestationPayload.nonce = Buffer.from(overrides.nonce, "hex");
  }

  // Encode payload as CBOR
  const payloadBytes = encodeCbor(attestationPayload);

  // Build COSE_Sign1 protected headers (empty map)
  const protectedHeaders = encodeCbor(new Map());

  // Build Sig_structure = ["Signature1", protected_headers, external_aad, payload]
  const sigStructure = encodeCbor([
    "Signature1",
    protectedHeaders,
    new Uint8Array(0),
    payloadBytes,
  ]);

  // Sign with leaf private key (ECDSA P-384 SHA384, ieee-p1363 format)
  const leafPrivateKey = crypto.createPrivateKey(leaf.keyPem);
  const signer = crypto.createSign("SHA384");
  signer.update(sigStructure);
  const signature = signer.sign({ key: leafPrivateKey, dsaEncoding: "ieee-p1363" });

  // Wrap in COSE_Sign1: [protected, unprotected, payload, signature]
  const coseSign1 = encodeCbor([protectedHeaders, {}, payloadBytes, signature]);

  const base64 = Buffer.from(coseSign1).toString("base64");

  return { base64, rootCaPem: root.certPem, embeddedPublicKey, timestamp };
}

describe("verifyNitroAttestation", () => {
  describe("rejection (invalid input)", () => {
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

    test("rejects CBOR array with wrong length and sets INVALID_COSE code", async () => {
      const { encode } = await import("cbor-x");
      const data = Buffer.from(encode([new Uint8Array(), {}, new Uint8Array()])).toString("base64");
      try {
        await verifyNitroAttestation(data);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.INVALID_COSE);
      }
    });
  });

  describe("happy path", () => {
    test("verifies a valid attestation document and returns the public key", async () => {
      const { base64, rootCaPem, embeddedPublicKey } = await buildTestAttestation();
      const result = await verifyNitroAttestation(base64, { rootCaPem });

      expect(result.publicKey).toBe(embeddedPublicKey);
      expect(result.document.moduleId).toBe("test-module-id");
      expect(result.document.digest).toBe("SHA384");
      expect(result.document.pcrs.get(0)).toBeInstanceOf(Uint8Array);
    });

    test("verifies with matching PCR values", async () => {
      const pcr0Hex = "aa".repeat(48);
      const { base64, rootCaPem } = await buildTestAttestation({
        pcrs: { 0: pcr0Hex },
      });
      const result = await verifyNitroAttestation(base64, {
        rootCaPem,
        expectedPCRs: { 0: pcr0Hex },
      });
      expect(result.document.pcrs.get(0)).toBeDefined();
    });

    test("verifies with matching nonce", async () => {
      const nonce = "deadbeef01020304";
      const { base64, rootCaPem, embeddedPublicKey } = await buildTestAttestation({ nonce });
      const result = await verifyNitroAttestation(base64, {
        rootCaPem,
        expectedNonce: nonce,
      });
      expect(result.publicKey).toBe(embeddedPublicKey);
    });
  });

  describe("verification failures", () => {
    test("rejects expired attestation with EXPIRED code", async () => {
      const { base64, rootCaPem } = await buildTestAttestation({
        timestamp: Date.now() - 10 * 60 * 1000,
      });
      try {
        await verifyNitroAttestation(base64, { rootCaPem, maxAgeMs: 60_000 });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.EXPIRED);
      }
    });

    test("rejects PCR mismatch with PCR_MISMATCH code", async () => {
      const { base64, rootCaPem } = await buildTestAttestation({
        pcrs: { 0: "aa".repeat(48) },
      });
      try {
        await verifyNitroAttestation(base64, {
          rootCaPem,
          expectedPCRs: { 0: "bb".repeat(48) },
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.PCR_MISMATCH);
      }
    });

    test("rejects nonce mismatch with NONCE_MISMATCH code", async () => {
      const { base64, rootCaPem } = await buildTestAttestation({
        nonce: "deadbeef01020304",
      });
      try {
        await verifyNitroAttestation(base64, {
          rootCaPem,
          expectedNonce: "0000000000000000",
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.NONCE_MISMATCH);
      }
    });

    test("rejects missing nonce with NONCE_MISMATCH code", async () => {
      const { base64, rootCaPem } = await buildTestAttestation();
      try {
        await verifyNitroAttestation(base64, {
          rootCaPem,
          expectedNonce: "deadbeef",
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.NONCE_MISMATCH);
      }
    });

    test("rejects wrong root CA", async () => {
      const { base64 } = await buildTestAttestation();
      // Use default root CA (AWS Nitro) — won't match test chain
      await expect(verifyNitroAttestation(base64)).rejects.toThrow();
    });

    test("rejects mismatched root CA with CHAIN_FAILED code", async () => {
      const { base64 } = await buildTestAttestation();
      // Generate a different root CA — valid cert but didn't sign our chain
      const otherRoot = generateCert({ subject: "/CN=Other Root CA", ca: true });
      try {
        await verifyNitroAttestation(base64, { rootCaPem: otherRoot.certPem });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AttestationError);
        expect((err as AttestationError).code).toBe(AttestationErrorCode.CHAIN_FAILED);
      }
    });
  });
});
