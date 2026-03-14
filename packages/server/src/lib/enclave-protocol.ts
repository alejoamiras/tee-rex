/**
 * Types for the host ↔ enclave HTTP protocol.
 *
 * The host Express server communicates with the thin enclave service
 * over HTTP (via socat vsock bridge). These types define the contract.
 */

/** Version info with its binary SHA256 hash. */
export interface BbVersionInfo {
  version: string;
  sha256: string;
}

/** GET /health response from enclave. */
export interface EnclaveHealthResponse {
  status: "ok" | "error";
  versions: BbVersionInfo[];
}

/** GET /attestation response from enclave. */
export interface EnclaveAttestationResponse {
  mode: "standard" | "nitro";
  publicKey: string;
  attestationDocument?: string;
  bbVersions?: BbVersionInfo[];
}

/** POST /upload-bb response from enclave. */
export interface EnclaveUploadResponse {
  version: string;
  sha256: string;
}
