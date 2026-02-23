import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger.js";

/** Default Azure MAA shared endpoint (East US). */
const DEFAULT_MAA_ENDPOINT = "https://sharedeus.eus.attest.azure.net";

/** Azure MAA API version for SGX attestation. */
const MAA_API_VERSION = "2022-08-01";

export interface SgxAttestationVerifyOptions {
  /** Azure MAA endpoint. Default: https://sharedeus.eus.attest.azure.net */
  maaEndpoint?: string;
  /** Maximum quote age in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
  /** Expected MRENCLAVE (hex). If set, verified against the MAA JWT claims. */
  expectedMrEnclave?: string;
  /** Expected MRSIGNER (hex). If set, verified against the MAA JWT claims. */
  expectedMrSigner?: string;
}

export class SgxAttestationError extends Error {
  readonly code: SgxAttestationErrorCode;

  constructor(
    message: string,
    code: SgxAttestationErrorCode = SgxAttestationErrorCode.INVALID_QUOTE,
  ) {
    super(message);
    this.name = "SgxAttestationError";
    this.code = code;
  }
}

export const SgxAttestationErrorCode = {
  INVALID_QUOTE: "INVALID_QUOTE",
  MAA_VERIFICATION_FAILED: "MAA_VERIFICATION_FAILED",
  JWT_VERIFICATION_FAILED: "JWT_VERIFICATION_FAILED",
  MRENCLAVE_MISMATCH: "MRENCLAVE_MISMATCH",
  MRSIGNER_MISMATCH: "MRSIGNER_MISMATCH",
  EXPIRED: "EXPIRED",
  REPORT_DATA_MISMATCH: "REPORT_DATA_MISMATCH",
} as const;
export type SgxAttestationErrorCode =
  (typeof SgxAttestationErrorCode)[keyof typeof SgxAttestationErrorCode];

/** Claims extracted from the MAA-verified JWT. */
export interface SgxAttestationResult {
  /** The public key (verified via user_report_data hash binding). */
  publicKey: string;
  /** MRENCLAVE value from the quote (hex). */
  mrEnclave: string;
  /** MRSIGNER value from the quote (hex). */
  mrSigner: string;
}

/**
 * Verify an SGX DCAP attestation quote via Azure MAA (Microsoft Azure Attestation).
 *
 * Verification steps:
 * 1. POST the raw quote to Azure MAA's `/attest/SgxEnclave` endpoint
 * 2. MAA verifies the DCAP quote (PCK cert chain, TCB, QE identity) and returns a signed JWT
 * 3. Verify the JWT signature against MAA's JWKS signing keys
 * 4. Extract MRENCLAVE, MRSIGNER, and report data from JWT claims
 * 5. Optionally check MRENCLAVE/MRSIGNER against expected values
 * 6. Verify that the quote's user_report_data contains the SHA-256 hash of the provided public key
 *
 * @param quoteBase64 - Base64-encoded SGX DCAP quote
 * @param publicKey - The armored OpenPGP public key claimed by the enclave
 * @param options - Verification options (MAA endpoint, expected measurements, freshness)
 */
export async function verifySgxAttestation(
  quoteBase64: string,
  publicKey: string,
  options: SgxAttestationVerifyOptions = {},
): Promise<SgxAttestationResult> {
  const {
    maaEndpoint = DEFAULT_MAA_ENDPOINT,
    maxAgeMs = 5 * 60 * 1000,
    expectedMrEnclave,
    expectedMrSigner,
  } = options;

  // 1. Submit quote to Azure MAA for verification
  const attestUrl = `${maaEndpoint}/attest/SgxEnclave?api-version=${MAA_API_VERSION}`;
  const maaResponse = await fetch(attestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote: quoteBase64 }),
  });

  if (!maaResponse.ok) {
    const errorBody = await maaResponse.text();
    throw new SgxAttestationError(
      `Azure MAA attestation failed (${maaResponse.status}): ${errorBody}`,
      SgxAttestationErrorCode.MAA_VERIFICATION_FAILED,
    );
  }

  const maaResult = (await maaResponse.json()) as { token: string };
  if (!maaResult.token) {
    throw new SgxAttestationError(
      "Azure MAA returned no token",
      SgxAttestationErrorCode.MAA_VERIFICATION_FAILED,
    );
  }

  // 2. Verify the MAA JWT signature against MAA's JWKS endpoint.
  // maaEndpoint can be absolute (https://...) or a relative proxy path (/maa).
  // new URL() requires an absolute base, so resolve relative paths against the current origin.
  const certsPath = `${maaEndpoint}/certs`;
  const jwksUrl = certsPath.startsWith("http")
    ? new URL(certsPath)
    : new URL(certsPath, globalThis.location?.origin);
  const jwks = createRemoteJWKSet(jwksUrl);

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(maaResult.token, jwks, {
      // MAA tokens use the real endpoint URL as issuer, even when proxied.
      issuer: maaEndpoint.startsWith("http") ? maaEndpoint : DEFAULT_MAA_ENDPOINT,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new SgxAttestationError(
      `MAA JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
      SgxAttestationErrorCode.JWT_VERIFICATION_FAILED,
    );
  }

  // 3. Check freshness
  const iat = payload.iat as number | undefined;
  if (iat) {
    const tokenAge = Date.now() - iat * 1000;
    if (tokenAge > maxAgeMs) {
      throw new SgxAttestationError(
        `SGX attestation too old (${Math.round(tokenAge / 1000)}s > ${Math.round(maxAgeMs / 1000)}s)`,
        SgxAttestationErrorCode.EXPIRED,
      );
    }
  }

  // 4. Extract SGX-specific claims from the MAA JWT
  const mrEnclave = (payload["x-ms-sgx-mrenclave"] as string) ?? "";
  const mrSigner = (payload["x-ms-sgx-mrsigner"] as string) ?? "";

  // 5. Verify MRENCLAVE if expected
  if (expectedMrEnclave) {
    if (mrEnclave.toLowerCase() !== expectedMrEnclave.toLowerCase()) {
      throw new SgxAttestationError(
        `MRENCLAVE mismatch: expected ${expectedMrEnclave}, got ${mrEnclave}`,
        SgxAttestationErrorCode.MRENCLAVE_MISMATCH,
      );
    }
  }

  // 6. Verify MRSIGNER if expected
  if (expectedMrSigner) {
    if (mrSigner.toLowerCase() !== expectedMrSigner.toLowerCase()) {
      throw new SgxAttestationError(
        `MRSIGNER mismatch: expected ${expectedMrSigner}, got ${mrSigner}`,
        SgxAttestationErrorCode.MRSIGNER_MISMATCH,
      );
    }
  }

  // 7. Verify public key binding via user_report_data
  // The enclave embeds SHA-256(publicKey) in the quote's user_report_data field.
  // MAA exposes this as x-ms-sgx-report-data (hex-encoded, 64 bytes = 128 hex chars).
  const reportData = (payload["x-ms-sgx-report-data"] as string) ?? "";
  if (reportData) {
    const reportDataBytes = Buffer.from(reportData, "hex");
    // user_report_data is 64 bytes; the SHA-256 hash occupies the first 32 bytes
    const reportHash = reportDataBytes.subarray(0, 32);
    const publicKeyHash = await sha256(new TextEncoder().encode(publicKey));
    if (!reportHash.equals(publicKeyHash)) {
      throw new SgxAttestationError(
        "Public key hash does not match quote's user_report_data",
        SgxAttestationErrorCode.REPORT_DATA_MISMATCH,
      );
    }
  }

  logger.info("SGX attestation verified successfully", {
    mrEnclave: mrEnclave.slice(0, 16),
    mrSigner: mrSigner.slice(0, 16),
  });

  return { publicKey, mrEnclave, mrSigner };
}

async function sha256(data: Uint8Array): Promise<Buffer> {
  const hash = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return Buffer.from(hash);
}
