/**
 * Thin enclave service — runs inside a Nitro Enclave via Bun.serve().
 *
 * Responsibilities: key generation, attestation (with bb hashes in user_data),
 * decryption, and bb prove. The host manages bb downloads and uploads them here.
 */
import { chmodSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { Base64 } from "ox";
import type { AttestationService, TeeMode } from "./lib/attestation-service.js";
import { createAttestationService } from "./lib/attestation-service.js";
import { BbHashCache, computeBbHash } from "./lib/bb-hash.js";
import { versionsBaseDir } from "./lib/bb-versions.js";
import { EncryptionService } from "./lib/encryption-service.js";
import { setupLogging } from "./lib/logging.js";
import { ProverService } from "./lib/prover-service.js";

const logger = getLogger(["tee-rex", "enclave"]);

export interface EnclaveDependencies {
  encryption: EncryptionService;
  attestation: AttestationService;
  bbHashCache: BbHashCache;
  /** Creates a ProverService on demand (after at least one bb is uploaded). */
  createProver: () => ProverService;
}

export function createEnclaveServer(
  deps: EnclaveDependencies,
  options: { port?: number; maxRequestBodySize?: number } = {},
) {
  const { encryption, attestation, bbHashCache } = deps;
  let prover: ProverService | null = null;

  function getProver(): ProverService {
    if (!prover) {
      prover = deps.createProver();
    }
    return prover;
  }

  const server = Bun.serve({
    port: options.port ?? 4000,
    maxRequestBodySize: options.maxRequestBodySize ?? 300_000_000, // 300MB for bb uploads
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      try {
        if (method === "POST" && url.pathname === "/upload-bb") {
          return await handleUploadBb(req, bbHashCache);
        }
        if (method === "POST" && url.pathname === "/prove") {
          return await handleProve(req, encryption, getProver);
        }
        if (method === "GET" && url.pathname === "/attestation") {
          return await handleAttestation(encryption, attestation, bbHashCache);
        }
        if (method === "GET" && url.pathname === "/public-key") {
          return await handlePublicKey(encryption);
        }
        if (method === "GET" && url.pathname === "/health") {
          return handleHealth(bbHashCache);
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      } catch (err) {
        logger.error("Unhandled error", {
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
        });
        return Response.json({ error: "Internal server error" }, { status: 500 });
      }
    },
  });

  return server;
}

async function handleUploadBb(req: Request, bbHashCache: BbHashCache): Promise<Response> {
  const version = req.headers.get("x-bb-version");
  if (!version) {
    return Response.json({ error: "Missing x-bb-version header" }, { status: 400 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) {
    return Response.json({ error: "Empty body" }, { status: 400 });
  }

  const versionDir = join(versionsBaseDir(), version);
  const tmpDir = `${versionDir}.tmp`;
  const bbPath = join(versionDir, "bb");
  const tmpBbPath = join(tmpDir, "bb");

  // Atomic write: write to temp dir, then rename
  await mkdir(tmpDir, { recursive: true });
  await Bun.write(tmpBbPath, body);
  chmodSync(tmpBbPath, 0o755);

  // Atomic rename
  try {
    renameSync(tmpDir, versionDir);
  } catch {
    // If target already exists (race condition), overwrite
    rmSync(versionDir, { recursive: true, force: true });
    renameSync(tmpDir, versionDir);
  }

  const sha256 = await computeBbHash(bbPath);
  bbHashCache.set(version, sha256);

  logger.info("bb uploaded", { version, sha256, size: body.byteLength });
  return Response.json({ version, sha256 });
}

async function handleProve(
  req: Request,
  encryption: EncryptionService,
  getProver: () => ProverService,
): Promise<Response> {
  const aztecVersion = req.headers.get("x-aztec-version") ?? undefined;
  logger.info("Prove request received", { aztecVersion });

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) {
    return Response.json({ error: "Empty body" }, { status: 400 });
  }

  let decryptedData: Uint8Array;
  const decryptStart = performance.now();
  try {
    decryptedData = await encryption.decrypt({ data: new Uint8Array(body) });
  } catch (err) {
    logger.warn("Failed to decrypt", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "Failed to decrypt request payload" }, { status: 400 });
  }
  const decryptDurationMs = Math.round(performance.now() - decryptStart);

  const proveStart = performance.now();
  const proof = await getProver().createChonkProof(decryptedData, aztecVersion);
  const proveDurationMs = Math.round(performance.now() - proveStart);

  logger.info("Prove completed", { aztecVersion, proveDurationMs, decryptDurationMs });

  return new Response(JSON.stringify({ proof: Base64.fromBytes(proof) }), {
    headers: {
      "Content-Type": "application/json",
      "x-prove-duration-ms": String(proveDurationMs),
      "x-decrypt-duration-ms": String(decryptDurationMs),
    },
  });
}

async function handleAttestation(
  encryption: EncryptionService,
  attestation: AttestationService,
  bbHashCache: BbHashCache,
): Promise<Response> {
  const publicKey = await encryption.getEncryptionPublicKey();
  const userData = new TextEncoder().encode(JSON.stringify({ versions: bbHashCache.all() }));
  const result = await attestation.getAttestation(publicKey, userData);
  return Response.json(result);
}

async function handlePublicKey(encryption: EncryptionService): Promise<Response> {
  const publicKey = await encryption.getEncryptionPublicKey();
  return Response.json({ publicKey });
}

function handleHealth(bbHashCache: BbHashCache): Response {
  return Response.json({
    status: "ok",
    versions: bbHashCache.all(),
  });
}

if (import.meta.main) {
  await setupLogging();

  const teeMode = (process.env.TEE_MODE ?? "standard") as TeeMode;
  const port = Number(process.env.PORT) || 4000;

  // Ensure versions directory exists
  mkdirSync(versionsBaseDir(), { recursive: true });

  const deps: EnclaveDependencies = {
    encryption: new EncryptionService(),
    attestation: createAttestationService(teeMode),
    bbHashCache: new BbHashCache(),
    createProver: () => new ProverService(),
  };

  createEnclaveServer(deps, { port });
  logger.info("Enclave service started", { port, teeMode });
}
