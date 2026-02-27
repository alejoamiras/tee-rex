import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger.js";

/** Default Intel Trust Authority (ITA) endpoint (US/Global). */
const DEFAULT_ITA_ENDPOINT = "https://api.trustauthority.intel.com";

/** ITA attestation API path for standalone SGX quotes. */
const ITA_ATTEST_PATH = "/appraisal/v1/attest";

/** ITA JWKS endpoint for verifying attestation JWT signatures. */
const DEFAULT_ITA_JWKS_URL = "https://portal.trustauthority.intel.com/certs";

export interface SgxAttestationVerifyOptions {
  /** ITA endpoint. Default: https://api.trustauthority.intel.com */
  itaEndpoint?: string;
  /** ITA API key (required for production use). */
  itaApiKey?: string;
  /** ITA JWKS URL for verifying JWT signatures. Default: https://portal.trustauthority.intel.com/certs */
  itaJwksUrl?: string;
  /** Maximum quote age in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
  /** Expected MRENCLAVE (hex). If set, verified against the ITA JWT claims. */
  expectedMrEnclave?: string;
  /** Expected MRSIGNER (hex). If set, verified against the ITA JWT claims. */
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
  ITA_VERIFICATION_FAILED: "ITA_VERIFICATION_FAILED",
  JWT_VERIFICATION_FAILED: "JWT_VERIFICATION_FAILED",
  MRENCLAVE_MISMATCH: "MRENCLAVE_MISMATCH",
  MRSIGNER_MISMATCH: "MRSIGNER_MISMATCH",
  EXPIRED: "EXPIRED",
  REPORT_DATA_MISMATCH: "REPORT_DATA_MISMATCH",
} as const;
export type SgxAttestationErrorCode =
  (typeof SgxAttestationErrorCode)[keyof typeof SgxAttestationErrorCode];

/** Claims extracted from the ITA-verified JWT. */
export interface SgxAttestationResult {
  /** The public key (verified via user_report_data hash binding). */
  publicKey: string;
  /** MRENCLAVE value from the quote (hex). */
  mrEnclave: string;
  /** MRSIGNER value from the quote (hex). */
  mrSigner: string;
}

/**
 * Verify an SGX DCAP attestation quote via Intel Trust Authority (ITA).
 *
 * Verification steps:
 * 1. POST the raw quote to ITA's `/appraisal/v1/attest` endpoint
 * 2. ITA verifies the DCAP quote (PCK cert chain, TCB, QE identity) and returns a signed JWT
 * 3. Verify the JWT signature against ITA's JWKS signing keys
 * 4. Extract MRENCLAVE, MRSIGNER, and report data from JWT claims
 * 5. Optionally check MRENCLAVE/MRSIGNER against expected values
 * 6. Verify that the quote's user_report_data contains the SHA-256 hash of the provided public key
 *
 * @param quoteBase64 - Base64-encoded SGX DCAP quote
 * @param publicKey - The armored OpenPGP public key claimed by the enclave
 * @param options - Verification options (ITA endpoint, expected measurements, freshness)
 */
export async function verifySgxAttestation(
  quoteBase64: string,
  publicKey: string,
  options: SgxAttestationVerifyOptions = {},
): Promise<SgxAttestationResult> {
  const {
    itaEndpoint = DEFAULT_ITA_ENDPOINT,
    itaApiKey,
    itaJwksUrl = DEFAULT_ITA_JWKS_URL,
    maxAgeMs = 5 * 60 * 1000,
    expectedMrEnclave,
    expectedMrSigner,
  } = options;

  // 1. Submit quote to Intel Trust Authority for verification
  const attestUrl = `${itaEndpoint}${ITA_ATTEST_PATH}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (itaApiKey) {
    headers["x-api-key"] = itaApiKey;
  }

  const itaResponse = await fetch(attestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ quote: quoteBase64 }),
  });

  if (!itaResponse.ok) {
    const errorBody = await itaResponse.text();
    throw new SgxAttestationError(
      `ITA attestation failed (${itaResponse.status}): ${errorBody}`,
      SgxAttestationErrorCode.ITA_VERIFICATION_FAILED,
    );
  }

  // ITA returns the JWT token directly as the response body
  const token = await itaResponse.text();
  if (!token || !token.includes(".")) {
    throw new SgxAttestationError(
      "ITA returned no valid token",
      SgxAttestationErrorCode.ITA_VERIFICATION_FAILED,
    );
  }

  // 2. Verify the ITA JWT signature against ITA's JWKS endpoint.
  // itaJwksUrl can be absolute (https://...) or a relative proxy path (/ita-certs).
  const jwksUrl = itaJwksUrl.startsWith("http")
    ? new URL(itaJwksUrl)
    : new URL(itaJwksUrl, globalThis.location?.origin);
  const jwks = createRemoteJWKSet(jwksUrl);

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: itaEndpoint.startsWith("http") ? itaEndpoint : DEFAULT_ITA_ENDPOINT,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new SgxAttestationError(
      `ITA JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
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

  // 4. Extract SGX-specific claims from the ITA JWT
  const mrEnclave = (payload.sgx_mrenclave as string) ?? "";
  const mrSigner = (payload.sgx_mrsigner as string) ?? "";

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
  // ITA exposes this as sgx_report_data (hex-encoded, 64 bytes = 128 hex chars).
  const reportData = (payload.sgx_report_data as string) ?? "";
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
