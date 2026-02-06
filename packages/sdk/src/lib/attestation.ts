import { logger } from "./logger.js";

/**
 * AWS Nitro Enclaves Root CA certificate (PEM).
 * Source: https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip
 */
const AWS_NITRO_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28nQPJNS+1kDz1IKLDf9MnJHKMG
MQgR+HQB3hqgRqNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

/** Parsed fields from a Nitro attestation document. */
export interface NitroAttestationDocument {
  moduleId: string;
  timestamp: number;
  digest: string;
  pcrs: Map<number, Uint8Array>;
  certificate: Uint8Array;
  cabundle: Uint8Array[];
  publicKey?: Uint8Array;
  userData?: Uint8Array;
  nonce?: Uint8Array;
}

/** Options for attestation verification. */
export interface AttestationVerifyOptions {
  /** Expected PCR values. Only the specified PCR indices are checked. */
  expectedPCRs?: Record<number, string>;
  /** Maximum age of the attestation document in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
}

/**
 * Verify a Nitro attestation document and extract the embedded public key.
 *
 * Verification steps:
 * 1. Decode the COSE_Sign1 envelope
 * 2. Extract and parse the CBOR attestation document payload
 * 3. Build and verify the certificate chain (cabundle → leaf → AWS Nitro root CA)
 * 4. Verify the COSE_Sign1 signature using the leaf certificate
 * 5. Optionally check PCR values and document freshness
 * 6. Return the embedded public key
 *
 * Note: This function dynamically imports `node:crypto` and `cbor-x` so that
 * the SDK can be loaded in browser environments (where standard mode is used)
 * without failing on the top-level import.
 */
export async function verifyNitroAttestation(
  attestationDocumentBase64: string,
  options: AttestationVerifyOptions = {},
): Promise<{ publicKey: string; document: NitroAttestationDocument }> {
  const { maxAgeMs = 5 * 60 * 1000 } = options;

  // Dynamic imports — only needed for Nitro verification (not in browser/standard mode)
  const [{ createVerify, X509Certificate }, { decode: decodeCbor, encode: encodeCbor }] =
    await Promise.all([import("node:crypto"), import("cbor-x")]);

  // 1. Decode the COSE_Sign1 envelope
  const raw = Buffer.from(attestationDocumentBase64, "base64");
  const coseSign1 = decodeCbor(raw) as [
    Uint8Array,
    Record<string, unknown>,
    Uint8Array,
    Uint8Array,
  ];

  if (!Array.isArray(coseSign1) || coseSign1.length !== 4) {
    throw new AttestationError("Invalid COSE_Sign1 structure");
  }

  const [protectedHeaders, , payload, signature] = coseSign1;

  // 2. Parse the attestation document from the payload
  const doc = decodeCbor(payload) as Record<string, unknown>;
  const attestationDoc = parseAttestationDocument(doc);

  // 3. Build and verify certificate chain
  const leafCert = new X509Certificate(attestationDoc.certificate);
  const rootCa = new X509Certificate(AWS_NITRO_ROOT_CA_PEM);

  // Build chain: cabundle contains certs from root to intermediate(s)
  const caBundleCerts = attestationDoc.cabundle.map((der) => new X509Certificate(der));
  verifyCertificateChain(leafCert, caBundleCerts, rootCa);

  // 4. Verify COSE_Sign1 signature
  //    Sig_structure = ["Signature1", protected_headers, external_aad, payload]
  const sigStructure = encodeCbor(["Signature1", protectedHeaders, new Uint8Array(0), payload]);

  const leafPublicKey = leafCert.publicKey;
  const verifier = createVerify("SHA384");
  verifier.update(sigStructure);
  const signatureValid = verifier.verify(
    { key: leafPublicKey, dsaEncoding: "ieee-p1363" },
    signature,
  );

  if (!signatureValid) {
    throw new AttestationError("COSE_Sign1 signature verification failed");
  }

  // 5. Check freshness
  const docAge = Date.now() - attestationDoc.timestamp;
  if (docAge > maxAgeMs) {
    throw new AttestationError(
      `Attestation document is too old (${Math.round(docAge / 1000)}s > ${Math.round(maxAgeMs / 1000)}s)`,
    );
  }

  // 6. Check PCR values if specified
  if (options.expectedPCRs) {
    for (const [index, expectedHex] of Object.entries(options.expectedPCRs)) {
      const pcrIndex = Number(index);
      const actual = attestationDoc.pcrs.get(pcrIndex);
      if (!actual) {
        throw new AttestationError(`PCR${pcrIndex} not found in attestation document`);
      }
      const actualHex = Buffer.from(actual).toString("hex");
      if (actualHex !== expectedHex.toLowerCase()) {
        throw new AttestationError(
          `PCR${pcrIndex} mismatch: expected ${expectedHex}, got ${actualHex}`,
        );
      }
    }
  }

  // 7. Extract public key
  if (!attestationDoc.publicKey) {
    throw new AttestationError("Attestation document does not contain a public key");
  }

  const publicKey = new TextDecoder().decode(attestationDoc.publicKey);

  logger.info("Nitro attestation verified successfully", {
    moduleId: attestationDoc.moduleId,
    pcr0: Buffer.from(attestationDoc.pcrs.get(0) ?? new Uint8Array())
      .toString("hex")
      .slice(0, 16),
  });

  return { publicKey, document: attestationDoc };
}

function parseAttestationDocument(doc: Record<string, unknown>): NitroAttestationDocument {
  if (typeof doc.module_id !== "string") {
    throw new AttestationError("Missing or invalid module_id");
  }
  if (typeof doc.timestamp !== "number") {
    throw new AttestationError("Missing or invalid timestamp");
  }
  if (typeof doc.digest !== "string") {
    throw new AttestationError("Missing or invalid digest");
  }
  if (!(doc.pcrs instanceof Map)) {
    throw new AttestationError("Missing or invalid pcrs");
  }
  if (!(doc.certificate instanceof Uint8Array)) {
    throw new AttestationError("Missing or invalid certificate");
  }
  if (!Array.isArray(doc.cabundle)) {
    throw new AttestationError("Missing or invalid cabundle");
  }

  return {
    moduleId: doc.module_id,
    timestamp: doc.timestamp,
    digest: doc.digest,
    pcrs: doc.pcrs as Map<number, Uint8Array>,
    certificate: doc.certificate,
    cabundle: doc.cabundle as Uint8Array[],
    publicKey: doc.public_key instanceof Uint8Array ? doc.public_key : undefined,
    userData: doc.user_data instanceof Uint8Array ? doc.user_data : undefined,
    nonce: doc.nonce instanceof Uint8Array ? doc.nonce : undefined,
  };
}

function verifyCertificateChain(
  leaf: import("node:crypto").X509Certificate,
  intermediates: import("node:crypto").X509Certificate[],
  root: import("node:crypto").X509Certificate,
): void {
  // Verify root is self-signed
  if (!root.verify(root.publicKey)) {
    throw new AttestationError("Root CA is not self-signed");
  }

  // Build ordered chain: root → intermediates → leaf
  const chain = [root, ...intermediates, leaf];

  for (let i = 1; i < chain.length; i++) {
    const cert = chain[i]!;
    const issuer = chain[i - 1]!;

    if (!cert.verify(issuer.publicKey)) {
      throw new AttestationError(`Certificate chain verification failed at index ${i}`);
    }

    // Check validity period
    const now = new Date();
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      throw new AttestationError(`Certificate at index ${i} is not within its validity period`);
    }
  }
}

export class AttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationError";
  }
}
