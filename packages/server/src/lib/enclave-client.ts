import { getLogger } from "@logtape/logtape";
import type {
  EnclaveAttestationResponse,
  EnclaveHealthResponse,
  EnclaveUploadResponse,
} from "./enclave-protocol.js";

const logger = getLogger(["tee-rex", "server", "enclave-client"]);

export interface ProveResult {
  proof: string;
  proveDurationMs: number;
  decryptDurationMs: number;
}

/** Typed HTTP client for host → enclave communication. */
export class EnclaveClient {
  #baseUrl: string;

  constructor(baseUrl = "http://localhost:4000") {
    this.#baseUrl = baseUrl;
  }

  async prove(encryptedData: ArrayBuffer, aztecVersion?: string): Promise<ProveResult> {
    const headers: Record<string, string> = {};
    if (aztecVersion) headers["x-aztec-version"] = aztecVersion;

    const res = await fetch(`${this.#baseUrl}/prove`, {
      method: "POST",
      headers,
      body: encryptedData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Enclave prove failed (${res.status}): ${body}`);
    }

    const body = (await res.json()) as { proof: string };
    return {
      proof: body.proof,
      proveDurationMs: Number(res.headers.get("x-prove-duration-ms") ?? 0),
      decryptDurationMs: Number(res.headers.get("x-decrypt-duration-ms") ?? 0),
    };
  }

  async getAttestation(): Promise<EnclaveAttestationResponse> {
    const res = await fetch(`${this.#baseUrl}/attestation`);
    if (!res.ok) {
      throw new Error(`Enclave attestation failed (${res.status})`);
    }
    return (await res.json()) as EnclaveAttestationResponse;
  }

  async getPublicKey(): Promise<string> {
    const res = await fetch(`${this.#baseUrl}/public-key`);
    if (!res.ok) {
      throw new Error(`Enclave public-key failed (${res.status})`);
    }
    const body = (await res.json()) as { publicKey: string };
    return body.publicKey;
  }

  async uploadBb(version: string, bbBinaryPath: string): Promise<EnclaveUploadResponse> {
    const binary = await Bun.file(bbBinaryPath).arrayBuffer();
    logger.info("Uploading bb to enclave", { version, size: binary.byteLength });

    const res = await fetch(`${this.#baseUrl}/upload-bb`, {
      method: "POST",
      headers: { "x-bb-version": version },
      body: binary,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Enclave upload-bb failed (${res.status}): ${body}`);
    }

    const result = (await res.json()) as EnclaveUploadResponse;
    logger.info("bb uploaded to enclave", { version, sha256: result.sha256 });
    return result;
  }

  async health(): Promise<EnclaveHealthResponse> {
    const res = await fetch(`${this.#baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Enclave health failed (${res.status})`);
    }
    return (await res.json()) as EnclaveHealthResponse;
  }
}
