import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import type { PrivateExecutionStep } from "@aztec/stdlib/kernel";
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

/** Whether proofs are generated locally (WASM) or on a remote tee-rex server. */
export type ProvingMode = ValueOf<typeof ProvingMode>;
export const ProvingMode = {
  local: "local",
  remote: "remote",
} as const;

export interface TeeRexAttestationConfig {
  /** When true, reject servers running in standard (non-TEE) mode. Default: false. */
  requireAttestation?: boolean;
  /** Expected PCR values to verify against the attestation document. */
  expectedPCRs?: AttestationVerifyOptions["expectedPCRs"];
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

  async createChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    switch (this.#provingMode) {
      case "local": {
        logger.info("Using local prover", {
          steps: executionSteps.length,
          functions: executionSteps.map((s) => s.functionName),
        });
        const start = performance.now();
        const result = await super.createChonkProof(executionSteps);
        logger.info("Local proof completed", {
          durationMs: Math.round(performance.now() - start),
        });
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
    const executionStepsSerialized = executionSteps.map((step) => ({
      functionName: step.functionName,
      witness: Array.from(step.witness.entries()),
      bytecode: Base64.fromBytes(step.bytecode),
      vk: Base64.fromBytes(step.vk),
      timings: step.timings,
    }));
    logger.debug("Serialized payload", { chars: JSON.stringify(executionStepsSerialized).length });
    const encryptionPublicKey = await this.#fetchEncryptionPublicKey();
    const encryptedData = Base64.fromBytes(
      await encrypt({
        data: Bytes.fromString(JSON.stringify({ executionSteps: executionStepsSerialized })),
        encryptionPublicKey,
      }),
    ); // TODO(perf): serialize executionSteps -> bytes without intermediate encoding. Needs Aztec to support serialization of the PrivateExecutionStep class.
    const response = await ky
      .post(joinURL(this.apiUrl, "prove"), {
        json: { data: encryptedData },
        timeout: ms("5 min"),
        retry: 2,
      })
      .json();
    const data = z
      .object({
        proof: schemas.Buffer,
      })
      .parse(response);
    return ChonkProofWithPublicInputs.fromBuffer(data.proof);
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
