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
  | "proved"
  | "receive"
  | "fallback"
  | "downloading";

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

export interface TeeRexAcceleratorConfig {
  /** Port the accelerator listens on (HTTP). Default: 59833. */
  port?: number;
  /** Port the accelerator listens on (HTTPS, for Safari). Default: 59834. */
  httpsPort?: number;
  /** Host the accelerator binds to. Default: "127.0.0.1". */
  host?: string;
}

/** Fields shared by all proving modes. */
interface TeeRexProverBaseOptions {
  /** Circuit simulator. Defaults to WASMSimulator (lazy-loaded from @aztec/simulator/client). */
  simulator?: CircuitSimulator;
  /** Accelerator connection config (port, host). */
  accelerator?: TeeRexAcceleratorConfig;
  /** Phase transition callback for UI animation. */
  onPhase?: (phase: ProverPhase, data?: ProverPhaseData) => void;
}

/** Local WASM proving — no server, no attestation. */
interface TeeRexLocalOptions extends TeeRexProverBaseOptions {
  provingMode: "local";
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

/** Accelerated native proving — no server needed. */
interface TeeRexAcceleratedOptions extends TeeRexProverBaseOptions {
  provingMode?: "accelerated";
  apiUrl?: string;
  attestation?: never;
}

export type TeeRexProverOptions =
  | TeeRexLocalOptions
  | TeeRexUeeOptions
  | TeeRexTeeOptions
  | TeeRexAcceleratedOptions;

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

const DEFAULT_ACCELERATOR_PORT = 59833;
const DEFAULT_ACCELERATOR_HTTPS_PORT = 59834;
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
  /** Which protocol was used to reach the accelerator (`"http"` or `"https"`). */
  protocol?: "http" | "https";
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
  #onPhase: ((phase: ProverPhase, data?: ProverPhaseData) => void) | null = null;
  #acceleratorPort: number;
  #acceleratorHttpsPort: number;
  #acceleratorHost: string;
  #acceleratorProtocol: "http" | "https" | null = null;
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
      if (opts.accelerator) {
        if (opts.accelerator.port !== undefined) this.#acceleratorPort = opts.accelerator.port;
        if (opts.accelerator.httpsPort !== undefined)
          this.#acceleratorHttpsPort = opts.accelerator.httpsPort;
        if (opts.accelerator.host !== undefined) this.#acceleratorHost = opts.accelerator.host;
      }

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
        // Smart default: apiUrl → UEE, no apiUrl → accelerated
        this.#provingMode = opts.apiUrl ? ProvingMode.uee : ProvingMode.accelerated;
        if ("attestation" in opts && opts.attestation) {
          this.#attestationConfig = opts.attestation;
        }
      }
    }

    const envPort =
      typeof process !== "undefined" ? process.env?.TEE_REX_ACCELERATOR_PORT : undefined;
    const envHttpsPort =
      typeof process !== "undefined" ? process.env?.TEE_REX_ACCELERATOR_HTTPS_PORT : undefined;
    // Only override if not already set by options
    this.#acceleratorPort ??= envPort ? Number.parseInt(envPort, 10) : DEFAULT_ACCELERATOR_PORT;
    this.#acceleratorHttpsPort ??= envHttpsPort
      ? Number.parseInt(envHttpsPort, 10)
      : DEFAULT_ACCELERATOR_HTTPS_PORT;
    this.#acceleratorHost ??= DEFAULT_ACCELERATOR_HOST;
  }

  /** Switch between local WASM, UEE (server), or accelerated (native) proving. */
  setProvingMode(mode: "local"): void;
  setProvingMode(
    mode: "uee",
    opts: { apiUrl: string; attestation?: TeeRexAttestationConfig },
  ): void;
  setProvingMode(mode: "tee", opts: { apiUrl: string; attestation: TeeRexAttestationConfig }): void;
  setProvingMode(mode: "accelerated"): void;
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
      } else if (mode === "local" || mode === "accelerated") {
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

  /** Configure the local accelerator connection (port, host). Resets cached protocol. */
  setAcceleratorConfig(config: TeeRexAcceleratorConfig) {
    if (config.port !== undefined) this.#acceleratorPort = config.port;
    if (config.httpsPort !== undefined) this.#acceleratorHttpsPort = config.httpsPort;
    if (config.host !== undefined) this.#acceleratorHost = config.host;
    this.#acceleratorProtocol = null;
  }

  /** Register a callback for proof generation sub-phase transitions (for UI animation). */
  setOnPhase(callback: ((phase: ProverPhase, data?: ProverPhaseData) => void) | null) {
    this.#onPhase = callback;
  }

  get #acceleratorBaseUrl(): string {
    if (this.#acceleratorProtocol === "https") {
      return `https://${this.#acceleratorHost}:${this.#acceleratorHttpsPort}`;
    }
    return `http://${this.#acceleratorHost}:${this.#acceleratorPort}`;
  }

  /**
   * Probe the local accelerator's `/health` endpoint and return its status.
   * Works regardless of the current {@link ProvingMode} — use it to show
   * "Accelerator connected" / "Offline" in your UI before a prove call.
   */
  async checkAcceleratorStatus(): Promise<AcceleratorStatus> {
    const sdkAztecVersion = this.#getAztecVersion();
    const httpUrl = `http://${this.#acceleratorHost}:${this.#acceleratorPort}/health`;
    const httpsUrl = `https://${this.#acceleratorHost}:${this.#acceleratorHttpsPort}/health`;

    try {
      // Probe both HTTP and HTTPS in parallel — whichever responds first wins.
      // Chrome/Firefox: HTTP responds (~1ms), HTTPS rejection silently ignored.
      // Safari with HTTPS enabled: HTTP blocked (mixed content), HTTPS responds.
      // Both offline: AggregateError → { available: false }.
      const { res: response, protocol } = await Promise.any([
        fetch(httpUrl, { signal: AbortSignal.timeout(2000) }).then((res) => ({
          res,
          protocol: "http" as const,
        })),
        fetch(httpsUrl, { signal: AbortSignal.timeout(2000) }).then((res) => ({
          res,
          protocol: "https" as const,
        })),
      ]);

      this.#acceleratorProtocol = protocol;

      if (!response.ok)
        return { available: false, needsDownload: false, sdkAztecVersion, protocol };

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
          protocol,
        });
        return {
          available: true,
          needsDownload,
          acceleratorVersion,
          availableVersions,
          sdkAztecVersion,
          protocol,
        };
      }

      // Legacy protocol: exact version match
      if (acceleratorVersion && acceleratorVersion !== "unknown") {
        if (sdkAztecVersion && acceleratorVersion !== sdkAztecVersion) {
          logger.warn("Accelerator Aztec version mismatch", {
            accelerator: acceleratorVersion,
            sdk: sdkAztecVersion,
          });
          return {
            available: false,
            needsDownload: false,
            acceleratorVersion,
            sdkAztecVersion,
            protocol,
          };
        }
      }
      return {
        available: true,
        needsDownload: false,
        acceleratorVersion,
        sdkAztecVersion,
        protocol,
      };
    } catch {
      this.#acceleratorProtocol = null;
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
    const res = await ky.post(joinURL(this.#acceleratorBaseUrl, "prove"), {
      body: new Uint8Array(msgpack),
      timeout: ms("10 min"),
      retry: 0,
      headers: {
        "content-type": "application/octet-stream",
        ...(aztecVersion ? { "x-aztec-version": aztecVersion } : {}),
      },
    });
    const proveDurationMs = res.headers.get("x-prove-duration-ms");
    if (proveDurationMs) {
      logger.info("Accelerator server-side timing", { proveDurationMs: Number(proveDurationMs) });
      this.#onPhase?.("proved", { durationMs: Number(proveDurationMs) });
    }
    const response = await res.json<{ proof: string }>();

    this.#onPhase?.("receive");
    const proofBuffer = Buffer.from(response.proof, "base64");
    return ChonkProofWithPublicInputs.fromBuffer(proofBuffer);
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
