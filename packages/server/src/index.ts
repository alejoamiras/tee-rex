// test: server-only change detection
import { mapSchema, schemas } from "@aztec/stdlib/schemas";
import { expressLogger } from "@logtape/express";
import { getLogger } from "@logtape/logtape";
import cors from "cors";
import express from "express";
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

const logger = getLogger(["tee-rex", "server"]);

export interface AppDependencies {
  prover: ProverService;
  encryption: EncryptionService;
  attestation: AttestationService;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" })); // TODO: change to 1mb?
  app.use(expressLogger());

  app.post("/prove", async (req, res, next) => {
    try {
      req.socket.setTimeout(ms("5 min"));

      const encryptedData = Base64.toBytes(req.body.data);
      const decryptedData: unknown = JSON.parse(
        Bytes.toString(
          await deps.encryption.decrypt({
            data: encryptedData,
          }),
        ),
      );

      const data = z
        .object({
          executionSteps: z.array(
            z.object({
              functionName: z.string(),
              witness: mapSchema(z.number(), z.string()),
              bytecode: schemas.Buffer,
              vk: schemas.Buffer,
              timings: z.object({
                witgen: z.number(),
                gateCount: z.number().optional(),
              }),
            }),
          ),
        })
        .parse(decryptedData);
      const proof = await deps.prover.createChonkProof(data.executionSteps);
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
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error("Unhandled error", { error: err });
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}

if (import.meta.main) {
  await setupLogging();

  const teeMode = (process.env.TEE_MODE || "standard") as TeeMode;

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
