export type { AttestationVerifyOptions, NitroAttestationDocument } from "./lib/attestation.js";
export {
  AttestationError,
  AttestationErrorCode,
  verifyNitroAttestation,
} from "./lib/attestation.js";
export type {
  SgxAttestationResult,
  SgxAttestationVerifyOptions,
} from "./lib/sgx-attestation.js";
export {
  SgxAttestationError,
  SgxAttestationErrorCode,
  verifySgxAttestation,
} from "./lib/sgx-attestation.js";
export * from "./lib/tee-rex-prover.js";
