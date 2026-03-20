import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import type { CircuitSimulator } from "@aztec/simulator/client";
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

/** Whether proofs are generated locally (WASM) or on a UEE (Untrusted Execution Environment) server. */
export type ProvingMode = ValueOf<typeof ProvingMode>;
export const ProvingMode = {
  local: "local",
  uee: "uee",
} as const;

/** Sub-phases emitted during proof generation for UI animation. */
export type ProverPhase =
  | "serialize"
  | "fetch-attestation"
  | "encrypt"
  | "transmit"
  | "proving"
  | "proved"
  | "receive";

/** Data payload for the `"proved"` phase — carries the actual proving duration. */
export interface ProverPhaseData {
  durationMs: number;
}

export interface TeeRexAttestationConfig {
  /** When true, reject servers running in standard (non-TEE) mode. Default: false. */
  requireAttestation?: boolean;
  /** Expected PCR values to verify against the attestation document. */
  expectedPCRs?: AttestationVerifyOptions["expectedPCRs"];
  /** Maximum age of attestation documents in milliseconds. Default: 5 minutes. */
  maxAgeMs?: number;
}

/** Fields shared by all proving modes. */
interface TeeRexProverBaseOptions {
  /** Circuit simulator. Defaults to WASMSimulator (lazy-loaded from @aztec/simulator/client). */
  simulator?: CircuitSimulator;
  /** Phase transition callback for UI animation. */
  onPhase?: (phase: ProverPhase, data?: ProverPhaseData) => void;
}

/** Local WASM proving — no server, no attestation. */
interface TeeRexLocalOptions extends TeeRexProverBaseOptions {
  provingMode?: "local";
  apiUrl?: string;
  attestation?: never;
}

/** UEE server proving — apiUrl required, attestation optional. */
interface TeeRexUeeOptions extends TeeRexProverBaseOptions {
  provingMode?: "uee";
  /** TEE-Rex server URL. Required for UEE mode. */
  apiUrl: string;
  /** Attestation verification config (optional for UEE). */
  attestation?: TeeRexAttestationConfig;
}

/** TEE proving — apiUrl AND attestation required. */
interface TeeRexTeeOptions extends TeeRexProverBaseOptions {
  provingMode: "tee";
  /** TEE-Rex server URL. Required. */
  apiUrl: string;
  /** Attestation verification config. Required for TEE — proves the server runs in an enclave. */
  attestation: TeeRexAttestationConfig;
}

export type TeeRexProverOptions = TeeRexLocalOptions | TeeRexUeeOptions | TeeRexTeeOptions;

/**
 * Create a lazy-loading proxy for CircuitSimulator that dynamically imports
 * `@aztec/simulator/client` on first method call. This avoids adding
 * `@aztec/simulator` as a runtime dependency of the SDK.
 */
function createLazySimulator(): CircuitSimulator {
  let instance: CircuitSimulator | null = null;
  let loading: Promise<CircuitSimulator> | null = null;

  async function getInstance(): Promise<CircuitSimulator> {
    if (instance) return instance;
    if (!loading) {
      loading = import("@aztec/simulator/client")
        .then((mod) => {
          instance = new mod.WASMSimulator();
          return instance;
        })
        .catch(() => {
          loading = null;
          throw new Error(
            "No simulator provided and @aztec/simulator/client could not be loaded. " +
              "Install @aztec/simulator or pass a simulator in the constructor options.",
          );
        });
    }
    return loading;
  }

  // Return a proxy that forwards all property access to the lazy-loaded instance.
  return new Proxy({} as CircuitSimulator, {
    get(_target, prop) {
      // Return an async function that loads the simulator then delegates.
      return async (...args: unknown[]) => {
        const sim = await getInstance();
        return (sim as any)[prop](...args);
      };
    },
  });
}

/**
 * Aztec private kernel prover that can generate proofs locally (WASM) or on a UEE
 * (Untrusted Execution Environment) server.
 *
 * In UEE mode, witness data is encrypted with the server's attested public
 * key (curve25519 + AES-256-GCM) before being sent over the network.
 */
export class TeeRexProver extends BBLazyPrivateKernelProver {
  #provingMode: ProvingMode = ProvingMode.uee;
  #attestationConfig: TeeRexAttestationConfig = {};
  #onPhase: ((phase: ProverPhase, data?: ProverPhaseData) => void) | null = null;
  #apiUrl: string | undefined;

  /** @deprecated Use the options constructor instead: `new TeeRexProver({ apiUrl })` */
  constructor(apiUrl: string, ...args: ConstructorParameters<typeof BBLazyPrivateKernelProver>);
  constructor(options?: TeeRexProverOptions);
  constructor(apiUrlOrOptions?: string | TeeRexProverOptions, ...args: unknown[]) {
    if (typeof apiUrlOrOptions === "string") {
      // Legacy positional API: new TeeRexProver(url, simulator, options?)
      super(...(args as ConstructorParameters<typeof BBLazyPrivateKernelProver>));
      this.#apiUrl = apiUrlOrOptions;
    } else {
      // New options API: new TeeRexProver({ apiUrl, simulator, ... }) or new TeeRexProver()
      const opts = apiUrlOrOptions ?? {};
      super(opts.simulator ?? createLazySimulator());
      this.#apiUrl = opts.apiUrl;

      // Apply options
      if (opts.onPhase) this.#onPhase = opts.onPhase;

      // Determine proving mode
      const mode = opts.provingMode;
      if (mode === "tee") {
        // "tee" is a constructor convenience — maps to UEE + requireAttestation
        this.#provingMode = ProvingMode.uee;
        this.#attestationConfig = { ...opts.attestation, requireAttestation: true };
      } else if (mode) {
        this.#provingMode = mode;
        if ("attestation" in opts && opts.attestation) {
          this.#attestationConfig = opts.attestation;
        }
      } else {
        // Smart default: apiUrl → UEE, no apiUrl → local
        this.#provingMode = opts.apiUrl ? ProvingMode.uee : ProvingMode.local;
        if ("attestation" in opts && opts.attestation) {
          this.#attestationConfig = opts.attestation;
        }
      }
    }
  }

  /** Switch between local WASM or UEE (server) proving. */
  setProvingMode(mode: "local"): void;
  setProvingMode(
    mode: "uee",
    opts: { apiUrl: string; attestation?: TeeRexAttestationConfig },
  ): void;
  setProvingMode(mode: "tee", opts: { apiUrl: string; attestation: TeeRexAttestationConfig }): void;
  /** @deprecated Pass mode-specific options for type safety. */
  setProvingMode(mode: ProvingMode): void;
  setProvingMode(
    mode: ProvingMode | "tee",
    opts?: { apiUrl?: string; attestation?: TeeRexAttestationConfig },
  ): void {
    if (mode === "tee") {
      this.#provingMode = ProvingMode.uee;
      this.#apiUrl = opts?.apiUrl ?? this.#apiUrl;
      this.#attestationConfig = { ...opts?.attestation, requireAttestation: true };
    } else {
      this.#provingMode = mode;
      if (opts?.apiUrl !== undefined) this.#apiUrl = opts.apiUrl;
      if (opts?.attestation !== undefined) {
        this.#attestationConfig = opts.attestation;
      } else if (mode === "local") {
        this.#attestationConfig = {};
      }
    }
  }

  /** Update the tee-rex server URL used for UEE/TEE proving. */
  setApiUrl(url: string) {
    this.#apiUrl = url;
  }

  /** Configure attestation verification (PCR checks, freshness, require TEE). */
  setAttestationConfig(config: TeeRexAttestationConfig) {
    this.#attestationConfig = config;
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: ((phase: ProverPhase, data?: ProverPhaseData) => void) | null) {
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
        const localDurationMs = Math.round(performance.now() - start);
        logger.info("Local proof completed", { durationMs: localDurationMs });
        this.#onPhase?.("proved", { durationMs: localDurationMs });
        this.#onPhase?.("receive");
        return result;
      }
      case "uee": {
        logger.info("Using UEE prover");
        return this.#ueeCreateChonkProof(executionSteps);
      }
      default: {
        throw new UnreachableCaseError(this.#provingMode);
      }
    }
  }

  async #ueeCreateChonkProof(
    executionSteps: PrivateExecutionStep[],
  ): Promise<ChonkProofWithPublicInputs> {
    if (!this.#apiUrl) {
      throw new Error(
        "apiUrl is required for UEE proving mode. Pass it in constructor options or call setApiUrl().",
      );
    }
    logger.info("Creating chonk proof", { apiUrl: this.#apiUrl });
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
    const res = await ky.post(joinURL(this.#apiUrl, "prove"), {
      json: { data: encryptedData },
      timeout: ms("5 min"),
      retry: 2,
      headers: aztecVersion ? { "x-aztec-version": aztecVersion } : {},
    });
    const proveDurationMs = res.headers.get("x-prove-duration-ms");
    const decryptDurationMs = res.headers.get("x-decrypt-duration-ms");
    if (proveDurationMs || decryptDurationMs) {
      logger.info("Server-side timing", {
        proveDurationMs: proveDurationMs ? Number(proveDurationMs) : undefined,
        decryptDurationMs: decryptDurationMs ? Number(decryptDurationMs) : undefined,
      });
    }
    if (proveDurationMs) {
      this.#onPhase?.("proved", { durationMs: Number(proveDurationMs) });
    }
    const response = await res.json();
    this.#onPhase?.("receive");
    const data = z
      .object({
        proof: schemas.Buffer,
      })
      .parse(response);
    return ChonkProofWithPublicInputs.fromBuffer(data.proof);
  }

  #getAztecVersion(): string | undefined {
    return (sdkPkg.dependencies as Record<string, string | undefined>)["@aztec/stdlib"];
  }

  async #fetchEncryptionPublicKey() {
    const response = await ky.get(joinURL(this.#apiUrl!, "attestation"), { retry: 2 }).json();
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
