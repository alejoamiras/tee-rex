import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { type PrivateExecutionStep, serializePrivateExecutionSteps } from "@aztec/stdlib/kernel";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import { schemas } from "@aztec/stdlib/schemas";
import ky from "ky";
import ms from "ms";
import { Base64 } from "ox";
import { UnreachableCaseError, type ValueOf } from "ts-essentials";
import { joinURL } from "ufo";
import { z } from "zod";
import sdkPkg from "../../package.json" with { type: "json" };
import { type AttestationVerifyOptions, verifyNitroAttestation } from "./attestation.js";
import { encrypt } from "./encrypt.js";
import { logger } from "./logger.js";

/** Whether proofs are generated locally (WASM), on a UEE (Untrusted Execution Environment) server, or via a local native accelerator. */
export type ProvingMode = ValueOf<typeof ProvingMode>;
export const ProvingMode = {
  local: "local",
  uee: "uee",
  accelerated: "accelerated",
} as const;

/** Sub-phases emitted during proof generation for UI animation. */
export type ProverPhase =
  | "detect"
  | "serialize"
  | "fetch-attestation"
  | "encrypt"
  | "transmit"
  | "proving"
  | "receive"
  | "fallback"
  | "downloading";

export interface TeeRexAttestationConfig {
  /** When true, reject servers running in standard (non-TEE) mode. Default: false. */
  requireAttestation?: boolean;
  /** Expected PCR values to verify against the attestation document. */
  expectedPCRs?: AttestationVerifyOptions["expectedPCRs"];
  /** Maximum age of attestation documents in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
}

export interface TeeRexAcceleratorConfig {
  /** Port the accelerator listens on. Default: 59833. */
  port?: number;
  /** Host the accelerator binds to. Default: "127.0.0.1". */
  host?: string;
}

const DEFAULT_ACCELERATOR_PORT = 59833;
const DEFAULT_ACCELERATOR_HOST = "127.0.0.1";

/** Status of the local native accelerator, returned by {@link TeeRexProver.checkAcceleratorStatus}. */
export interface AcceleratorStatus {
  /** Whether the accelerator is reachable and compatible. */
  available: boolean;
  /** Whether the accelerator needs to download `bb` for the SDK's Aztec version. */
  needsDownload: boolean;
  /** Accelerator version string from the `/health` endpoint (legacy `aztec_version` field). */
  acceleratorVersion?: string;
  /** Aztec versions the accelerator already has cached. */
  availableVersions?: string[];
  /** The Aztec version this SDK expects (from its `@aztec/stdlib` dependency). */
  sdkAztecVersion?: string;
}

/**
 * Aztec private kernel prover that can generate proofs locally (WASM), on a UEE
 * (Untrusted Execution Environment) server, or via a local native accelerator.
 *
 * In UEE mode, witness data is encrypted with the server's attested public
 * key (curve25519 + AES-256-GCM) before being sent over the network.
 *
 * In accelerated mode, proving is routed to a native `bb` binary running on the
 * user's machine via `http://127.0.0.1:59833`. Falls back to WASM if unavailable.
 */
export class TeeRexProver extends BBLazyPrivateKernelProver {
  #provingMode: ProvingMode = ProvingMode.uee;
  #attestationConfig: TeeRexAttestationConfig = {};
  #onPhase: ((phase: ProverPhase) => void) | null = null;
  #acceleratorPort: number;
  #acceleratorHost: string;

  constructor(
    private apiUrl: string,
    ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>
  ) {
    super(...args);
    const envPort =
      typeof process !== "undefined" ? process.env?.TEE_REX_ACCELERATOR_PORT : undefined;
    this.#acceleratorPort = envPort ? Number.parseInt(envPort, 10) : DEFAULT_ACCELERATOR_PORT;
    this.#acceleratorHost = DEFAULT_ACCELERATOR_HOST;
  }

  /** Switch between local WASM, UEE (server), or accelerated (native) proving. */
  setProvingMode(mode: ProvingMode) {
    this.#provingMode = mode;
  }

  /** Update the tee-rex server URL used for UEE/TEE proving. */
  setApiUrl(url: string) {
    this.apiUrl = url;
  }

  /** Configure attestation verification (PCR checks, freshness, require TEE). */
  setAttestationConfig(config: TeeRexAttestationConfig) {
    this.#attestationConfig = config;
  }

  /** Configure the local accelerator connection (port, host). */
  setAcceleratorConfig(config: TeeRexAcceleratorConfig) {
    if (config.port !== undefined) this.#acceleratorPort = config.port;
    if (config.host !== undefined) this.#acceleratorHost = config.host;
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: ((phase: ProverPhase) => void) | null) {
    this.#onPhase = callback;
  }

  get #acceleratorBaseUrl(): string {
    return `http://${this.#acceleratorHost}:${this.#acceleratorPort}`;
  }

  /**
   * Probe the local accelerator's `/health` endpoint and return its status.
   * Works regardless of the current {@link ProvingMode} — use it to show
   * "Accelerator connected" / "Offline" in your UI before a prove call.
   */
  async checkAcceleratorStatus(): Promise<AcceleratorStatus> {
    const sdkAztecVersion = this.#getAztecVersion();
    try {
      const response = await fetch(joinURL(this.#acceleratorBaseUrl, "health"), {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return { available: false, needsDownload: false, sdkAztecVersion };

      const data = (await response.json()) as {
        aztec_version?: string;
        available_versions?: string[];
      };

      const acceleratorVersion = data.aztec_version;
      const availableVersions = data.available_versions;

      // New multi-version protocol: check available_versions array
      if (availableVersions) {
        const needsDownload = sdkAztecVersion
          ? !availableVersions.includes(sdkAztecVersion)
          : false;
        logger.info("Multi-version health check", {
          sdkAztecVersion,
          availableVersions,
          needsDownload,
        });
        return {
          available: true,
          needsDownload,
          acceleratorVersion,
          availableVersions,
          sdkAztecVersion,
        };
      }

      // Legacy protocol: exact version match
      if (acceleratorVersion && acceleratorVersion !== "unknown") {
        if (sdkAztecVersion && acceleratorVersion !== sdkAztecVersion) {
          logger.warn("Accelerator Aztec version mismatch", {
            accelerator: acceleratorVersion,
            sdk: sdkAztecVersion,
          });
          return { available: false, needsDownload: false, acceleratorVersion, sdkAztecVersion };
        }
      }
      return { available: true, needsDownload: false, acceleratorVersion, sdkAztecVersion };
    } catch {
      return { available: false, needsDownload: false, sdkAztecVersion };
    }
  }

  async createChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    switch (this.#provingMode) {
      case "local": {
        logger.info("Using local prover", {
          steps: executionSteps.length,
          functions: executionSteps.map((s) => s.functionName),
        });
        this.#onPhase?.("proving");
        const start = performance.now();
        const result = await super.createChonkProof(executionSteps);
        logger.info("Local proof completed", {
          durationMs: Math.round(performance.now() - start),
        });
        this.#onPhase?.("receive");
        return result;
      }
      case "uee": {
        logger.info("Using UEE prover");
        return this.#ueeCreateChonkProof(executionSteps);
      }
      case "accelerated": {
        logger.info("Using accelerated prover");
        return this.#acceleratedCreateChonkProof(executionSteps);
      }
      default: {
        throw new UnreachableCaseError(this.#provingMode);
      }
    }
  }

  async #ueeCreateChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    logger.info("Creating chonk proof", { apiUrl: this.apiUrl });
    this.#onPhase?.("serialize");
    const msgpack = serializePrivateExecutionSteps(executionSteps);
    logger.debug("Serialized payload", { bytes: msgpack.byteLength });
    this.#onPhase?.("fetch-attestation");
    const encryptionPublicKey = await this.#fetchEncryptionPublicKey();
    this.#onPhase?.("encrypt");
    const encryptedData = Base64.fromBytes(
      await encrypt({
        data: new Uint8Array(msgpack),
        encryptionPublicKey,
      }),
    );
    this.#onPhase?.("transmit");
    this.#onPhase?.("proving");
    const aztecVersion = this.#getAztecVersion();
    const response = await ky
      .post(joinURL(this.apiUrl, "prove"), {
        json: { data: encryptedData },
        timeout: ms("5 min"),
        retry: 2,
        headers: aztecVersion ? { "x-aztec-version": aztecVersion } : {},
      })
      .json();
    this.#onPhase?.("receive");
    const data = z
      .object({
        proof: schemas.Buffer,
      })
      .parse(response);
    return ChonkProofWithPublicInputs.fromBuffer(data.proof);
  }

  async #acceleratedCreateChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    this.#onPhase?.("detect");
    const { available, needsDownload } = await this.checkAcceleratorStatus();

    if (!available) {
      logger.info("Accelerator not available, falling back to WASM");
      this.#onPhase?.("fallback");
      this.#onPhase?.("proving");
      const proof = await super.createChonkProof(executionSteps);
      this.#onPhase?.("receive");
      return proof;
    }

    if (needsDownload) {
      logger.info("Accelerator needs to download bb for this version");
      this.#onPhase?.("downloading");
    }

    logger.info("Accelerator available, proving natively", {
      url: this.#acceleratorBaseUrl,
    });

    this.#onPhase?.("serialize");
    const msgpack = serializePrivateExecutionSteps(executionSteps);

    const aztecVersion = this.#getAztecVersion();

    this.#onPhase?.("transmit");
    this.#onPhase?.("proving");
    const response = await ky
      .post(joinURL(this.#acceleratorBaseUrl, "prove"), {
        body: new Uint8Array(msgpack),
        timeout: ms("10 min"),
        retry: 0,
        headers: {
          "content-type": "application/octet-stream",
          ...(aztecVersion ? { "x-aztec-version": aztecVersion } : {}),
        },
      })
      .json<{ proof: string }>();

    this.#onPhase?.("receive");
    const proofBuffer = Buffer.from(response.proof, "base64");
    return ChonkProofWithPublicInputs.fromBuffer(proofBuffer);
  }

  #getAztecVersion(): string | undefined {
    return (sdkPkg.dependencies as Record<string, string | undefined>)["@aztec/stdlib"];
  }

  async #fetchEncryptionPublicKey() {
    const response = await ky.get(joinURL(this.apiUrl, "attestation"), { retry: 2 }).json();
    const data = z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("standard"), publicKey: z.string() }),
        z.object({
          mode: z.literal("nitro"),
          attestationDocument: z.string(),
          publicKey: z.string(),
        }),
      ])
      .parse(response);

    switch (data.mode) {
      case "standard": {
        if (this.#attestationConfig.requireAttestation) {
          throw new Error(
            "Server is running in standard mode but requireAttestation is enabled. " +
              "The server must run inside a TEE to provide attestation.",
          );
        }
        logger.warn("Server is running in standard mode (no TEE attestation)");
        return data.publicKey;
      }
      case "nitro": {
        try {
          const { publicKey } = await verifyNitroAttestation(data.attestationDocument, {
            expectedPCRs: this.#attestationConfig.expectedPCRs,
            maxAgeMs: this.#attestationConfig.maxAgeMs,
          });
          return publicKey;
        } catch (err) {
          // In browser environments, node:crypto is unavailable. Fall back to the
          // server-provided public key. The attestation document was still fetched
          // over HTTPS; we just can't verify the COSE_Sign1 chain client-side.
          if (
            err instanceof Error &&
            (err.message.includes("node:crypto") || err.message.includes("is not a constructor"))
          ) {
            logger.warn(
              "Nitro attestation verification unavailable (browser environment). Using server-provided public key.",
              { error: err.message },
            );
            return data.publicKey;
          }
          throw err;
        }
      }
    }
  }
}
