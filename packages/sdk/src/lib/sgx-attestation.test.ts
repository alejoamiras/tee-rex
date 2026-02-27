import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import {
  SgxAttestationError,
  SgxAttestationErrorCode,
  verifySgxAttestation,
} from "./sgx-attestation.js";

/**
 * Build a mock ITA JWT token for testing.
 * NOT cryptographically signed — only useful for testing claim parsing
 * and error path behavior.
 */
function encodeMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "PS384", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${body}.${signature}`;
}

function buildMockItaPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sgx_mrenclave: "a".repeat(64),
    sgx_mrsigner: "b".repeat(64),
    sgx_report_data: "",
    sgx_is_debuggable: false,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

/**
 * Start a local HTTP server that mimics Intel Trust Authority.
 * The handler map controls responses for different paths.
 */
function startMockIta(handlers: {
  attest?: (body: string) => { status: number; body: string };
  certs?: () => { status: number; body: unknown };
}): Promise<{ endpoint: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        if (req.url?.startsWith("/appraisal/v1/attest") && handlers.attest) {
          const result = handlers.attest(body);
          res.writeHead(result.status, { "Content-Type": "text/plain" });
          res.end(result.body);
        } else if (req.url === "/certs" && handlers.certs) {
          const result = handlers.certs();
          res.writeHead(result.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result.body));
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        endpoint: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

let mockIta: { endpoint: string; close: () => void } | null = null;

afterEach(() => {
  mockIta?.close();
  mockIta = null;
});

describe("verifySgxAttestation", () => {
  describe("ITA endpoint errors", () => {
    test("throws ITA_VERIFICATION_FAILED when ITA returns HTTP error", async () => {
      mockIta = await startMockIta({
        attest: () => ({
          status: 400,
          body: "Invalid quote format",
        }),
      });

      try {
        await verifySgxAttestation("invalid-quote", "public-key", {
          itaEndpoint: mockIta.endpoint,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SgxAttestationError);
        expect((err as SgxAttestationError).code).toBe(
          SgxAttestationErrorCode.ITA_VERIFICATION_FAILED,
        );
      }
    });

    test("throws when ITA returns no valid token", async () => {
      mockIta = await startMockIta({
        attest: () => ({ status: 200, body: "" }),
      });

      try {
        await verifySgxAttestation("some-quote", "public-key", {
          itaEndpoint: mockIta.endpoint,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SgxAttestationError);
        expect((err as SgxAttestationError).code).toBe(
          SgxAttestationErrorCode.ITA_VERIFICATION_FAILED,
        );
      }
    });
  });

  describe("JWT verification failures", () => {
    test("throws JWT_VERIFICATION_FAILED when JWT signature cannot be verified", async () => {
      const payload = buildMockItaPayload();
      mockIta = await startMockIta({
        attest: () => ({ status: 200, body: encodeMockJwt(payload) }),
        // Empty JWKS — jose will fail to find a matching key
        certs: () => ({ status: 200, body: { keys: [] } }),
      });

      try {
        await verifySgxAttestation("valid-quote-base64", "public-key", {
          itaEndpoint: mockIta.endpoint,
          itaJwksUrl: `${mockIta.endpoint}/certs`,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SgxAttestationError);
        expect((err as SgxAttestationError).code).toBe(
          SgxAttestationErrorCode.JWT_VERIFICATION_FAILED,
        );
      }
    });
  });

  describe("error code types", () => {
    test("SgxAttestationError has correct name and code", () => {
      const err = new SgxAttestationError("test", SgxAttestationErrorCode.MRENCLAVE_MISMATCH);
      expect(err.name).toBe("SgxAttestationError");
      expect(err.code).toBe("MRENCLAVE_MISMATCH");
      expect(err).toBeInstanceOf(Error);
    });

    test("all error codes are defined", () => {
      expect(SgxAttestationErrorCode.INVALID_QUOTE).toBe("INVALID_QUOTE");
      expect(SgxAttestationErrorCode.ITA_VERIFICATION_FAILED).toBe("ITA_VERIFICATION_FAILED");
      expect(SgxAttestationErrorCode.JWT_VERIFICATION_FAILED).toBe("JWT_VERIFICATION_FAILED");
      expect(SgxAttestationErrorCode.MRENCLAVE_MISMATCH).toBe("MRENCLAVE_MISMATCH");
      expect(SgxAttestationErrorCode.MRSIGNER_MISMATCH).toBe("MRSIGNER_MISMATCH");
      expect(SgxAttestationErrorCode.EXPIRED).toBe("EXPIRED");
      expect(SgxAttestationErrorCode.REPORT_DATA_MISMATCH).toBe("REPORT_DATA_MISMATCH");
    });
  });
});

/**
 * Integration test against a real ITA endpoint with a real DCAP quote.
 * Skips when SGX_QUOTE_BASE64 is not set.
 */
describe.skipIf(!process.env.SGX_QUOTE_BASE64)("Real SGX attestation (integration)", () => {
  test("verifies a real DCAP quote via Intel Trust Authority", async () => {
    const result = await verifySgxAttestation(
      process.env.SGX_QUOTE_BASE64!,
      process.env.SGX_PUBLIC_KEY!,
      { itaApiKey: process.env.ITA_API_KEY },
    );
    expect(result.mrEnclave).toBeDefined();
    expect(result.mrEnclave.length).toBe(64);
    expect(result.mrSigner).toBeDefined();
    expect(result.mrSigner.length).toBe(64);
    expect(result.publicKey).toBe(process.env.SGX_PUBLIC_KEY);
  });
});
