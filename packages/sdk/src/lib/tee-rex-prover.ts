import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { type PrivateExecutionStep, serializePrivateExecutionSteps } from "@aztec/stdlib/kernel";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import { schemas } from "@aztec/stdlib/schemas";
import ky from "ky";
import ms from "ms";
import { Base64, Bytes } from "ox";
import { UnreachableCaseError, type ValueOf } from "ts-essentials";
import { joinURL } from "ufo";
import { z } from "zod";
import { type AttestationVerifyOptions, verifyNitroAttestation } from "./attestation.js";
import { encrypt } from "./encrypt.js";
import { logger } from "./logger.js";
import { type SgxAttestationVerifyOptions, verifySgxAttestation } from "./sgx-attestation.js";

/** Whether proofs are generated locally (WASM) or on a remote tee-rex server. */
export type ProvingMode = ValueOf<typeof ProvingMode>;
export const ProvingMode = {
  local: "local",
  remote: "remote",
} as const;

/** Sub-phases emitted during proof generation for UI animation. */
export type ProverPhase =
  | "serialize"
  | "fetch-attestation"
  | "encrypt"
  | "transmit"
  | "proving"
  | "receive";

export interface TeeRexAttestationConfig {
  /** When true, reject servers running in standard (non-TEE) mode. Default: false. */
  requireAttestation?: boolean;
  /** Expected PCR values to verify against the Nitro attestation document. */
  expectedPCRs?: AttestationVerifyOptions["expectedPCRs"];
  /** Expected MRENCLAVE value (hex) for SGX attestation. */
  expectedMrEnclave?: string;
  /** Expected MRSIGNER value (hex) for SGX attestation. */
  expectedMrSigner?: string;
  /** Intel Trust Authority endpoint for SGX DCAP verification. */
  itaEndpoint?: SgxAttestationVerifyOptions["itaEndpoint"];
  /** Intel Trust Authority API key for SGX DCAP verification. */
  itaApiKey?: SgxAttestationVerifyOptions["itaApiKey"];
  /** Maximum age of attestation documents in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
}

/**
 * Aztec private kernel prover that can generate proofs locally or on a remote
 * tee-rex server running inside an AWS Nitro Enclave.
 *
 * In remote mode, witness data is encrypted with the server's attested public
 * key (curve25519 + AES-256-GCM) before being sent over the network.
 */
export class TeeRexProver extends BBLazyPrivateKernelProver {
  #provingMode: ProvingMode = ProvingMode.remote;
  #attestationConfig: TeeRexAttestationConfig = {};
  #onPhase: ((phase: ProverPhase) => void) | null = null;

  constructor(
    private apiUrl: string,
    ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>
  ) {
    super(...args);
  }

  /** Switch between local WASM proving and remote TEE proving. */
  setProvingMode(mode: ProvingMode) {
    this.#provingMode = mode;
  }

  /** Update the tee-rex server URL used for remote proving. */
  setApiUrl(url: string) {
    this.apiUrl = url;
  }

  /** Configure attestation verification (PCR checks, freshness, require TEE). */
  setAttestationConfig(config: TeeRexAttestationConfig) {
    this.#attestationConfig = config;
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: ((phase: ProverPhase) => void) | null) {
    this.#onPhase = callback;
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
      case "remote": {
        logger.info("Using remote prover");
        return this.#remoteCreateChonkProof(executionSteps);
      }
      default: {
        throw new UnreachableCaseError(this.#provingMode);
      }
    }
  }

  async #remoteCreateChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    logger.info("Creating chonk proof", { apiUrl: this.apiUrl });
    this.#onPhase?.("serialize");
    this.#onPhase?.("fetch-attestation");
    const { publicKey: encryptionPublicKey, mode: serverMode } =
      await this.#fetchEncryptionPublicKey();
    this.#onPhase?.("encrypt");

    let payloadBytes: Uint8Array;
    if (serverMode === "sgx") {
      // SGX mode: serialize as msgpack (IVC inputs) so the enclave worker can
      // pass it directly to `bb prove --scheme chonk --ivc_inputs_path`.
      const msgpack = serializePrivateExecutionSteps(executionSteps);
      logger.debug("Serialized msgpack payload", { bytes: msgpack.length });
      payloadBytes = new Uint8Array(msgpack);
    } else {
      // Standard/Nitro mode: serialize as JSON for the Node.js prover service.
      const executionStepsSerialized = executionSteps.map((step) => ({
        functionName: step.functionName,
        witness: Array.from(step.witness.entries()),
        bytecode: Base64.fromBytes(step.bytecode),
        vk: Base64.fromBytes(step.vk),
        timings: step.timings,
      }));
      logger.debug("Serialized JSON payload", {
        chars: JSON.stringify(executionStepsSerialized).length,
      });
      payloadBytes = Bytes.fromString(JSON.stringify({ executionSteps: executionStepsSerialized }));
    }

    const encryptedData = Base64.fromBytes(
      await encrypt({ data: payloadBytes, encryptionPublicKey }),
    );
    this.#onPhase?.("transmit");
    this.#onPhase?.("proving");
    const response = await ky
      .post(joinURL(this.apiUrl, "prove"), {
        json: { data: encryptedData },
        timeout: ms("5 min"),
        retry: 2,
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

  async #fetchEncryptionPublicKey(): Promise<{
    publicKey: string;
    mode: "standard" | "nitro" | "sgx";
  }> {
    const response = await ky.get(joinURL(this.apiUrl, "attestation"), { retry: 2 }).json();
    const data = z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("standard"), publicKey: z.string() }),
        z.object({
          mode: z.literal("nitro"),
          attestationDocument: z.string(),
          publicKey: z.string(),
        }),
        z.object({
          mode: z.literal("sgx"),
          quote: z.string(),
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
        return { publicKey: data.publicKey, mode: data.mode };
      }
      case "nitro": {
        try {
          const { publicKey } = await verifyNitroAttestation(data.attestationDocument, {
            expectedPCRs: this.#attestationConfig.expectedPCRs,
            maxAgeMs: this.#attestationConfig.maxAgeMs,
          });
          return { publicKey, mode: data.mode };
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
            return { publicKey: data.publicKey, mode: data.mode };
          }
          throw err;
        }
      }
      case "sgx": {
        try {
          const { publicKey } = await verifySgxAttestation(data.quote, data.publicKey, {
            expectedMrEnclave: this.#attestationConfig.expectedMrEnclave,
            expectedMrSigner: this.#attestationConfig.expectedMrSigner,
            itaEndpoint: this.#attestationConfig.itaEndpoint,
            itaApiKey: this.#attestationConfig.itaApiKey,
            maxAgeMs: this.#attestationConfig.maxAgeMs,
          });
          return { publicKey, mode: data.mode };
        } catch (err) {
          // In browser environments, fetch to Intel Trust Authority may fail due to CORS.
          // Fall back to the server-provided public key over HTTPS.
          if (err instanceof TypeError && err.message.includes("fetch")) {
            logger.warn(
              "SGX attestation verification unavailable (browser environment). Using server-provided public key.",
              { error: err.message },
            );
            return { publicKey: data.publicKey, mode: data.mode };
          }
          throw err;
        }
      }
    }
  }
}
