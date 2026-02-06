import { getLogger } from "@logtape/logtape";

const logger = getLogger(["tee-rex", "server", "attestation"]);

export type TeeMode = "standard" | "nitro";

export type AttestationResponse =
  | { mode: "standard"; publicKey: string }
  | { mode: "nitro"; attestationDocument: string; publicKey: string };

export interface AttestationService {
  getAttestation(publicKey: string): Promise<AttestationResponse>;
}

/**
 * Standard mode: returns the encryption public key without any attestation.
 * Suitable for development and non-TEE deployments.
 */
export class StandardAttestationService implements AttestationService {
  async getAttestation(publicKey: string): Promise<AttestationResponse> {
    logger.info("Returning standard attestation (no TEE)");
    return { mode: "standard", publicKey };
  }
}

/**
 * Nitro mode: generates an AWS Nitro Enclave attestation document that embeds
 * the encryption public key. The attestation document is signed by the Nitro
 * Hypervisor and can be verified by clients using the AWS Nitro root CA.
 *
 * Uses Bun FFI to call libnsm.so (available inside Nitro Enclaves).
 */
export class NitroAttestationService implements AttestationService {
  async getAttestation(publicKey: string): Promise<AttestationResponse> {
    logger.info("Generating Nitro attestation document");
    const publicKeyBytes = new TextEncoder().encode(publicKey);
    const attestationDocument = await getNitroAttestationDocument(publicKeyBytes);
    const attestationDocumentBase64 = Buffer.from(attestationDocument).toString("base64");
    logger.info("Nitro attestation document generated", {
      size: attestationDocument.byteLength,
    });
    return {
      mode: "nitro",
      attestationDocument: attestationDocumentBase64,
      publicKey,
    };
  }
}

/**
 * Call the Nitro Security Module (NSM) via /dev/nsm ioctl to generate
 * an attestation document with the given public key embedded.
 *
 * The NSM device expects CBOR-encoded requests and returns CBOR-encoded responses.
 * The attestation document is a COSE_Sign1 structure containing PCR values,
 * certificates, and the embedded public key.
 */
async function getNitroAttestationDocument(publicKey: Uint8Array): Promise<Uint8Array> {
  // Dynamic import — only available inside a Nitro Enclave
  const { dlopen, FFIType, ptr } = await import("bun:ffi");

  const NSM_MAX_ATTESTATION_DOC_SIZE = 16 * 1024; // 16 KB

  const lib = dlopen("libnsm.so", {
    nsm_lib_init: {
      args: [],
      returns: FFIType.i32,
    },
    nsm_get_attestation_doc: {
      args: [
        FFIType.i32, // fd
        FFIType.ptr, // user_data
        FFIType.u32, // user_data_len
        FFIType.ptr, // nonce_data
        FFIType.u32, // nonce_len
        FFIType.ptr, // pub_key_data
        FFIType.u32, // pub_key_len
        FFIType.ptr, // att_doc_data (output)
        FFIType.ptr, // att_doc_len (output, pointer to u32)
      ],
      returns: FFIType.i32,
    },
    nsm_lib_exit: {
      args: [FFIType.i32],
      returns: FFIType.void,
    },
  });

  const fd = lib.symbols.nsm_lib_init();
  if (fd < 0) {
    throw new Error(
      `Failed to initialize NSM library (fd=${fd}). Are you running inside a Nitro Enclave?`,
    );
  }

  try {
    const attDocBuffer = new Uint8Array(NSM_MAX_ATTESTATION_DOC_SIZE);
    const attDocLen = new Uint32Array([NSM_MAX_ATTESTATION_DOC_SIZE]);

    const errorCode = lib.symbols.nsm_get_attestation_doc(
      fd,
      null, // user_data
      0, // user_data_len
      null, // nonce
      0, // nonce_len
      ptr(publicKey), // pub_key_data
      publicKey.byteLength, // pub_key_len
      ptr(attDocBuffer), // att_doc_data
      ptr(attDocLen), // att_doc_len
    );

    if (errorCode !== 0) {
      throw new Error(`NSM attestation request failed with error code ${errorCode}`);
    }

    return attDocBuffer.slice(0, attDocLen[0]);
  } finally {
    lib.symbols.nsm_lib_exit(fd);
  }
}

export function createAttestationService(mode: TeeMode): AttestationService {
  switch (mode) {
    case "standard":
      return new StandardAttestationService();
    case "nitro":
      return new NitroAttestationService();
    default:
      throw new Error(`Unknown TEE mode: ${mode}`);
  }
}
