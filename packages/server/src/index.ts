import { randomUUID } from "node:crypto";
import { availableParallelism, cpus } from "node:os";
import { getLogger } from "@logtape/logtape";
import {
  type AttestationService,
  createAttestationService,
  type TeeMode,
} from "./lib/attestation-service.js";
import { downloadBb } from "./lib/bb-download.js";
import { listCachedVersions } from "./lib/bb-versions.js";
import { EnclaveClient } from "./lib/enclave-client.js";
import { EncryptionService } from "./lib/encryption-service.js";
import { setupLogging } from "./lib/logging.js";
import { ProverService } from "./lib/prover-service.js";
import { getClientIp, isLocalhost, RateLimiter } from "./lib/rate-limit.js";

const logger = getLogger(["tee-rex", "server"]);

/** Bumped when the server API changes in a way that clients should detect. */
const API_VERSION = 1;

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Aztec-Version",
  "Access-Control-Expose-Headers":
    "X-Request-Id, X-Prove-Duration-Ms, X-Decrypt-Duration-Ms, X-Download-Duration-Ms, X-Upload-Duration-Ms",
};

function withCors(res: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

// ---------------------------------------------------------------------------
// App mode: standard (handles everything) or proxy (forwards to enclave)
// ---------------------------------------------------------------------------

export type AppMode =
  | {
      type: "standard";
      prover: ProverService;
      encryption: EncryptionService;
      attestation: AttestationService;
    }
  | {
      type: "proxy";
      enclaveClient: EnclaveClient;
    };

// ---------------------------------------------------------------------------
// JSON + header helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const res = Response.json(data, { status: init.status ?? 200 });
  if (init.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      res.headers.set(k, v);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// createHostServer
// ---------------------------------------------------------------------------

export function createHostServer(
  mode: AppMode,
  options: { port?: number; maxRequestBodySize?: number } = {},
) {
  const rateLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, limit: 10 });

  const server = Bun.serve({
    port: options.port ?? 4000,
    maxRequestBodySize: options.maxRequestBodySize ?? 50 * 1024 * 1024, // 50MB
    async fetch(req, server) {
      // CORS preflight
      if (req.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      const url = new URL(req.url);
      const requestId = req.headers.get("x-request-id") ?? randomUUID();

      // Request logging
      logger.info("Request", { method: req.method, path: url.pathname, requestId });

      try {
        let response: Response;

        if (req.method === "POST" && url.pathname === "/prove") {
          // Rate limiting
          const clientIp = getClientIp(req, server);
          if (!isLocalhost(clientIp) && rateLimiter.isLimited(clientIp)) {
            response = jsonResponse(
              { error: "Too many prove requests, try again later", requestId },
              { status: 429 },
            );
            response.headers.set("X-Request-Id", requestId);
            return withCors(response);
          }

          response =
            mode.type === "standard"
              ? await handleStandardProve(req, mode, requestId)
              : await handleProxyProve(req, mode.enclaveClient, requestId);
        } else if (req.method === "GET" && url.pathname === "/health") {
          response =
            mode.type === "standard"
              ? handleStandardHealth()
              : await handleProxyHealth(mode.enclaveClient);
        } else if (req.method === "GET" && url.pathname === "/attestation") {
          response =
            mode.type === "standard"
              ? await handleStandardAttestation(mode)
              : await handleProxyAttestation(mode.enclaveClient);
        } else if (req.method === "GET" && url.pathname === "/encryption-public-key") {
          response =
            mode.type === "standard"
              ? await handleStandardPublicKey(mode)
              : await handleProxyPublicKey(mode.enclaveClient);
        } else {
          response = jsonResponse({ error: "Not found", requestId }, { status: 404 });
        }

        response.headers.set("X-Request-Id", requestId);
        return withCors(response);
      } catch (err) {
        logger.error("Unhandled error", {
          requestId,
          error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        });
        const response = jsonResponse(
          { error: "Internal server error", requestId },
          { status: 500 },
        );
        response.headers.set("X-Request-Id", requestId);
        return withCors(response);
      }
    },
  });

  return server;
}

// ---------------------------------------------------------------------------
// Standard mode handlers
// ---------------------------------------------------------------------------

async function handleStandardProve(
  req: Request,
  mode: Extract<AppMode, { type: "standard" }>,
  requestId: string,
): Promise<Response> {
  const aztecVersion = req.headers.get("x-aztec-version") ?? undefined;
  logger.info("Prove request received", { requestId, aztecVersion });

  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Malformed request body", requestId }, { status: 400 });
  }

  if (typeof body?.data !== "string" || body.data.length === 0) {
    return jsonResponse(
      { error: "Invalid request body: expected { data: string }", requestId },
      { status: 400 },
    );
  }

  let decryptedData: Uint8Array;
  const headers: Record<string, string> = {};
  try {
    const decryptStart = performance.now();
    const encryptedData = Buffer.from(body.data, "base64");
    decryptedData = await mode.encryption.decrypt({ data: encryptedData });
    const decryptMs = Math.round(performance.now() - decryptStart);
    headers["x-decrypt-duration-ms"] = String(decryptMs);
    logger.info("Payload decrypted", { requestId, decryptMs, bytes: decryptedData.byteLength });
  } catch (err) {
    logger.warn("Failed to decrypt prove payload", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse({ error: "Failed to decrypt request payload", requestId }, { status: 400 });
  }

  const proveStart = performance.now();
  const proof = await mode.prover.createChonkProof(decryptedData, aztecVersion);
  const proveDurationMs = Math.round(performance.now() - proveStart);
  logger.info("Prove request completed", { requestId, aztecVersion, proveDurationMs });
  headers["x-prove-duration-ms"] = String(proveDurationMs);

  return jsonResponse({ proof: Buffer.from(proof).toString("base64") }, { headers });
}

function handleStandardHealth(): Response {
  return Response.json({
    status: "ok",
    api_version: API_VERSION,
    available_versions: listCachedVersions(),
    runtime: {
      hardware_concurrency: process.env.HARDWARE_CONCURRENCY ?? "unset",
      available_parallelism: availableParallelism(),
      cpu_count: cpus().length,
      tee_mode: process.env.TEE_MODE ?? "unset",
      node_env: process.env.NODE_ENV ?? "unset",
      crs_path: process.env.CRS_PATH ?? "unset",
    },
  });
}

async function handleStandardAttestation(
  mode: Extract<AppMode, { type: "standard" }>,
): Promise<Response> {
  const publicKey = await mode.encryption.getEncryptionPublicKey();
  const attestation = await mode.attestation.getAttestation(publicKey);
  return Response.json(attestation);
}

async function handleStandardPublicKey(
  mode: Extract<AppMode, { type: "standard" }>,
): Promise<Response> {
  const publicKey = await mode.encryption.getEncryptionPublicKey();
  return Response.json({ publicKey });
}

// ---------------------------------------------------------------------------
// Proxy mode handlers
// ---------------------------------------------------------------------------

async function handleProxyProve(
  req: Request,
  enclaveClient: EnclaveClient,
  requestId: string,
): Promise<Response> {
  const aztecVersion = req.headers.get("x-aztec-version") ?? undefined;
  logger.info("Prove request received (proxy)", { requestId, aztecVersion });

  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Malformed request body", requestId }, { status: 400 });
  }

  if (typeof body?.data !== "string" || body.data.length === 0) {
    return jsonResponse(
      { error: "Invalid request body: expected { data: string }", requestId },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = {};

  // Check if enclave has the requested bb version, download + upload if missing
  if (aztecVersion) {
    const health = await enclaveClient.health();
    const hasVersion = health.versions.some((v) => v.version === aztecVersion);
    if (!hasVersion) {
      logger.info("bb version not in enclave, downloading", { requestId, version: aztecVersion });
      const downloadStart = performance.now();
      const bbPath = await downloadBb(aztecVersion);
      const downloadDurationMs = Math.round(performance.now() - downloadStart);
      headers["x-download-duration-ms"] = String(downloadDurationMs);

      const uploadStart = performance.now();
      await enclaveClient.uploadBb(aztecVersion, bbPath);
      const uploadDurationMs = Math.round(performance.now() - uploadStart);
      headers["x-upload-duration-ms"] = String(uploadDurationMs);

      logger.info("bb uploaded to enclave", {
        requestId,
        version: aztecVersion,
        downloadDurationMs,
        uploadDurationMs,
      });
    }
  }

  const encryptedData = Buffer.from(body.data, "base64");
  const result = await enclaveClient.prove(encryptedData.buffer as ArrayBuffer, aztecVersion);

  headers["x-prove-duration-ms"] = String(result.proveDurationMs);
  headers["x-decrypt-duration-ms"] = String(result.decryptDurationMs);
  logger.info("Prove request completed (proxy)", {
    requestId,
    aztecVersion,
    proveDurationMs: result.proveDurationMs,
  });

  return jsonResponse({ proof: result.proof }, { headers });
}

async function handleProxyHealth(enclaveClient: EnclaveClient): Promise<Response> {
  let enclaveHealth: Awaited<ReturnType<typeof enclaveClient.health>> | null = null;
  try {
    enclaveHealth = await enclaveClient.health();
  } catch {
    logger.warn("Enclave unreachable during health check");
  }

  return Response.json({
    status: "ok",
    api_version: API_VERSION,
    available_versions: enclaveHealth?.versions.map((v) => v.version) ?? [],
    bb_hashes: enclaveHealth?.versions ?? [],
    enclave: enclaveHealth ? "ok" : "unreachable",
    runtime: {
      hardware_concurrency: process.env.HARDWARE_CONCURRENCY ?? "unset",
      available_parallelism: availableParallelism(),
      cpu_count: cpus().length,
      tee_mode: process.env.TEE_MODE ?? "unset",
      node_env: process.env.NODE_ENV ?? "unset",
      crs_path: process.env.CRS_PATH ?? "unset",
    },
  });
}

async function handleProxyAttestation(enclaveClient: EnclaveClient): Promise<Response> {
  const attestation = await enclaveClient.getAttestation();
  return Response.json(attestation);
}

async function handleProxyPublicKey(enclaveClient: EnclaveClient): Promise<Response> {
  const publicKey = await enclaveClient.getPublicKey();
  return Response.json({ publicKey });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  await setupLogging();

  const teeMode: TeeMode = process.env.TEE_MODE === "nitro" ? "nitro" : "standard";

  let mode: AppMode;
  if (teeMode === "nitro") {
    const enclaveUrl = process.env.ENCLAVE_URL || "http://localhost:4000";
    logger.info("Starting in proxy mode", { enclaveUrl });
    mode = { type: "proxy", enclaveClient: new EnclaveClient(enclaveUrl) };
  } else {
    mode = {
      type: "standard",
      prover: new ProverService(),
      encryption: new EncryptionService(),
      attestation: createAttestationService(teeMode),
    };
  }

  const port = Number(process.env.PORT) || 4000;
  const server = createHostServer(mode, { port });
  logger.info("Server started", { port, teeMode, mode: mode.type, url: server.url.href });

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down");
    server.stop();
  });
}
