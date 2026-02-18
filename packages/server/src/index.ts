import { randomUUID } from "node:crypto";
import { PrivateExecutionStepSchema } from "@aztec/stdlib/kernel";
import { expressLogger } from "@logtape/express";
import { getLogger } from "@logtape/logtape";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import ms from "ms";
import { Base64, Bytes } from "ox";
import { z } from "zod";
import {
  type AttestationService,
  createAttestationService,
  type TeeMode,
} from "./lib/attestation-service.js";
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

export interface AppDependencies {
  prover: ProverService;
  encryption: EncryptionService;
  attestation: AttestationService;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // Assign a unique request ID to each request, returned in X-Request-Id header
  app.use((req, res, next) => {
    const id = (req.headers["x-request-id"] as string) || randomUUID();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  app.use(expressLogger());

  const proveLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 10, // 10 requests per hour per IP
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many prove requests, try again later" },
  });

  app.post("/prove", proveLimiter, async (req, res, next) => {
    try {
      req.socket.setTimeout(ms("5 min"));
      logger.info("Prove request received", { requestId: req.id });

      const body = z.object({ data: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res
          .status(400)
          .json({ error: "Invalid request body: expected { data: string }", requestId: req.id });
        return;
      }
      const encryptedData = Base64.toBytes(body.data.data);
      const decryptedData: unknown = JSON.parse(
        Bytes.toString(
          await deps.encryption.decrypt({
            data: encryptedData,
          }),
        ),
      );

      const data = z
        .object({ executionSteps: z.array(PrivateExecutionStepSchema) })
        .parse(decryptedData);
      const proof = await deps.prover.createChonkProof(data.executionSteps);
      logger.info("Prove request completed", { requestId: req.id });
      res.json({
        proof: Base64.fromBytes(proof.toBuffer()), // proof will be publicly posted on chain, so no need to encrypt
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/attestation", async (_req, res, next) => {
    try {
      const publicKey = await deps.encryption.getEncryptionPublicKey();
      const attestation = await deps.attestation.getAttestation(publicKey);
      res.json(attestation);
    } catch (err) {
      next(err);
    }
  });

  // Backward-compatible alias
  app.get("/encryption-public-key", async (_req, res, next) => {
    try {
      const publicKey = await deps.encryption.getEncryptionPublicKey();
      res.json({ publicKey });
    } catch (err) {
      next(err);
    }
  });

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
      logger.error("Unhandled error", {
        requestId,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
      res.status(500).json({ error: "Internal server error", requestId });
    },
  );

  return app;
}

if (import.meta.main) {
  await setupLogging();

  const teeMode = z
    .enum(["standard", "nitro"])
    .catch("standard")
    .parse(process.env.TEE_MODE) as TeeMode;

  const app = createApp({
    prover: new ProverService(),
    encryption: new EncryptionService(),
    attestation: createAttestationService(teeMode),
  });

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    logger.info("Server started", { port, teeMode });
  });
}
