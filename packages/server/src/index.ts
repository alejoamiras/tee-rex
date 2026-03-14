import { randomUUID } from "node:crypto";
import { availableParallelism, cpus } from "node:os";
import { expressLogger } from "@logtape/express";
import { getLogger } from "@logtape/logtape";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import ms from "ms";
import { Base64 } from "ox";
import { z } from "zod";
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

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

const logger = getLogger(["tee-rex", "server"]);

/** Bumped when the server API changes in a way that clients should detect. */
const API_VERSION = 1;

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

/** @deprecated Use AppMode instead. Kept for backward compat with existing test helpers. */
export interface AppDependencies {
  prover: ProverService;
  encryption: EncryptionService;
  attestation: AttestationService;
}

export function createApp(mode: AppMode | AppDependencies): express.Express {
  // Backward compat: if AppDependencies is passed (no `type` field), treat as standard
  const resolvedMode: AppMode =
    "type" in mode
      ? mode
      : {
          type: "standard",
          prover: mode.prover,
          encryption: mode.encryption,
          attestation: mode.attestation,
        };

  const app = express();

  // --- Shared middleware (both modes) ---

  // Permissive CORS: in prod the server sits behind CloudFront (same-origin),
  // and in dev the Vite proxy handles it. This keeps the server itself stateless.
  app.use(cors());

  // The server always runs behind a reverse proxy (CloudFront + socat).
  // Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
  // when it sees the X-Forwarded-For header that CloudFront adds.
  // Use 1 (not true) to trust only the first proxy hop — `true` is too
  // permissive and triggers ERR_ERL_PERMISSIVE_TRUST_PROXY.
  app.set("trust proxy", 1);

  // Assign a unique request ID to each request, returned in X-Request-Id header.
  // Runs before body parsing so that parsing errors include the request ID.
  app.use((req, res, next) => {
    const id = (req.headers["x-request-id"] as string) || randomUUID();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  app.use(expressLogger());
  // Proving payloads are large (encrypted witness + bytecode + VK, base64-encoded).
  // 50mb accommodates the largest expected proving requests.
  app.use(express.json({ limit: "50mb" }));

  const proveLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 10, // 10 requests per hour per IP
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many prove requests, try again later" },
    skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1",
  });

  // --- Routes ---

  if (resolvedMode.type === "standard") {
    registerStandardRoutes(app, resolvedMode, proveLimiter);
  } else {
    registerProxyRoutes(app, resolvedMode.enclaveClient, proveLimiter);
  }

  // --- Error handler (shared) ---

  app.use(
    (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const requestId = req.id;
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: err.issues, requestId });
        return;
      }
      if (err instanceof SyntaxError && "body" in err) {
        res.status(400).json({ error: "Malformed request body", requestId });
        return;
      }
      if (err instanceof Error && "status" in err && (err as any).status === 413) {
        res.status(413).json({ error: "Request payload too large", requestId });
        return;
      }
      logger.error("Unhandled error", {
        requestId,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
      res.status(500).json({ error: "Internal server error", requestId });
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Standard mode routes — handles everything locally
// ---------------------------------------------------------------------------

function registerStandardRoutes(
  app: express.Express,
  mode: Extract<AppMode, { type: "standard" }>,
  proveLimiter: ReturnType<typeof rateLimit>,
) {
  app.post("/prove", proveLimiter, async (req, res, next) => {
    try {
      req.socket.setTimeout(ms("5 min"));
      const aztecVersion = req.headers["x-aztec-version"] as string | undefined;
      logger.info("Prove request received", { requestId: req.id, aztecVersion });

      const body = z.object({ data: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res
          .status(400)
          .json({ error: "Invalid request body: expected { data: string }", requestId: req.id });
        return;
      }
      let decryptedData: Uint8Array;
      try {
        const decryptStart = performance.now();
        const encryptedData = Base64.toBytes(body.data.data);
        decryptedData = await mode.encryption.decrypt({ data: encryptedData });
        const decryptMs = Math.round(performance.now() - decryptStart);
        res.setHeader("x-decrypt-duration-ms", decryptMs);
        logger.info("Payload decrypted", {
          requestId: req.id,
          decryptMs,
          bytes: decryptedData.byteLength,
        });
      } catch (err) {
        logger.warn("Failed to decrypt prove payload", {
          requestId: req.id,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(400).json({ error: "Failed to decrypt request payload", requestId: req.id });
        return;
      }

      const proveStart = performance.now();
      const proof = await mode.prover.createChonkProof(decryptedData, aztecVersion);
      const proveDurationMs = Math.round(performance.now() - proveStart);
      logger.info("Prove request completed", { requestId: req.id, aztecVersion, proveDurationMs });
      res.setHeader("x-prove-duration-ms", proveDurationMs);
      res.json({
        proof: Base64.fromBytes(proof),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
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
  });

  app.get("/attestation", async (_req, res, next) => {
    try {
      const publicKey = await mode.encryption.getEncryptionPublicKey();
      const attestation = await mode.attestation.getAttestation(publicKey);
      res.json(attestation);
    } catch (err) {
      next(err);
    }
  });

  // Backward-compatible alias
  app.get("/encryption-public-key", async (_req, res, next) => {
    try {
      const publicKey = await mode.encryption.getEncryptionPublicKey();
      res.json({ publicKey });
    } catch (err) {
      next(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Proxy mode routes — forwards to enclave
// ---------------------------------------------------------------------------

function registerProxyRoutes(
  app: express.Express,
  enclaveClient: EnclaveClient,
  proveLimiter: ReturnType<typeof rateLimit>,
) {
  app.post("/prove", proveLimiter, async (req, res, next) => {
    try {
      req.socket.setTimeout(ms("5 min"));
      const aztecVersion = req.headers["x-aztec-version"] as string | undefined;
      logger.info("Prove request received (proxy)", { requestId: req.id, aztecVersion });

      const body = z.object({ data: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res
          .status(400)
          .json({ error: "Invalid request body: expected { data: string }", requestId: req.id });
        return;
      }

      // Check if enclave has the requested bb version, download + upload if missing
      if (aztecVersion) {
        const health = await enclaveClient.health();
        const hasVersion = health.versions.some((v) => v.version === aztecVersion);
        if (!hasVersion) {
          logger.info("bb version not in enclave, downloading", {
            requestId: req.id,
            version: aztecVersion,
          });
          const downloadStart = performance.now();
          const bbPath = await downloadBb(aztecVersion);
          const downloadDurationMs = Math.round(performance.now() - downloadStart);
          res.setHeader("x-download-duration-ms", downloadDurationMs);

          const uploadStart = performance.now();
          await enclaveClient.uploadBb(aztecVersion, bbPath);
          const uploadDurationMs = Math.round(performance.now() - uploadStart);
          res.setHeader("x-upload-duration-ms", uploadDurationMs);

          logger.info("bb uploaded to enclave", {
            requestId: req.id,
            version: aztecVersion,
            downloadDurationMs,
            uploadDurationMs,
          });
        }
      }

      const encryptedData = Base64.toBytes(body.data.data);
      const result = await enclaveClient.prove(encryptedData.buffer as ArrayBuffer, aztecVersion);

      res.setHeader("x-prove-duration-ms", result.proveDurationMs);
      res.setHeader("x-decrypt-duration-ms", result.decryptDurationMs);
      logger.info("Prove request completed (proxy)", {
        requestId: req.id,
        aztecVersion,
        proveDurationMs: result.proveDurationMs,
      });
      res.json({ proof: result.proof });
    } catch (err) {
      next(err);
    }
  });

  app.get("/health", async (_req, res, next) => {
    try {
      const enclaveHealth = await enclaveClient.health();
      res.json({
        status: "ok",
        api_version: API_VERSION,
        available_versions: enclaveHealth.versions.map((v) => v.version),
        bb_hashes: enclaveHealth.versions,
        runtime: {
          hardware_concurrency: process.env.HARDWARE_CONCURRENCY ?? "unset",
          available_parallelism: availableParallelism(),
          cpu_count: cpus().length,
          tee_mode: process.env.TEE_MODE ?? "unset",
          node_env: process.env.NODE_ENV ?? "unset",
          crs_path: process.env.CRS_PATH ?? "unset",
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/attestation", async (_req, res, next) => {
    try {
      const attestation = await enclaveClient.getAttestation();
      res.json(attestation);
    } catch (err) {
      next(err);
    }
  });

  // Backward-compatible alias
  app.get("/encryption-public-key", async (_req, res, next) => {
    try {
      const publicKey = await enclaveClient.getPublicKey();
      res.json({ publicKey });
    } catch (err) {
      next(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  await setupLogging();

  const teeMode = z
    .enum(["standard", "nitro"])
    .catch("standard")
    .parse(process.env.TEE_MODE) as TeeMode;

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

  const app = createApp(mode);

  const port = process.env.PORT || 4000;
  const server = app.listen(port, () => {
    logger.info("Server started", { port, teeMode, mode: mode.type });
  });

  // Bun's node:http compat layer doesn't ref the server handle, so the event
  // loop drains and the process exits immediately. This timer keeps it alive.
  const keepAlive = setInterval(() => {}, 1 << 30);

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down");
    clearInterval(keepAlive);
    server.close(() => process.exit(0));
  });
}
