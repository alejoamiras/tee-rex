import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ChonkProofWithPublicInputs } from "@aztec/stdlib/proofs";
import { getLogger } from "@logtape/logtape";

const execFileAsync = promisify(execFile);

const logger = getLogger(["tee-rex", "server", "prover"]);

/**
 * Resolve the native Barretenberg binary path from the installed @aztec/bb.js package.
 * Throws if the binary can't be found (msgpack proving requires the native binary).
 */
export function resolveBbPath(): string {
  const require = createRequire(import.meta.url);
  const bbProverPath = require.resolve("@aztec/bb-prover");
  const bbProverRequire = createRequire(bbProverPath);
  const bbJsEntry = bbProverRequire.resolve("@aztec/bb.js");
  const bbJsRoot = join(dirname(bbJsEntry), "..", "..");
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const os = process.platform === "darwin" ? "macos" : "linux";
  const bbPath = join(bbJsRoot, "build", `${arch}-${os}`, "bb");
  const fs = require("node:fs");
  if (!fs.existsSync(bbPath)) {
    throw new Error(`Native bb binary not found at ${bbPath}`);
  }
  logger.info("Resolved native Barretenberg", { bbPath });
  return bbPath;
}

export class ProverService {
  #bbPath: string;

  constructor() {
    this.#bbPath = resolveBbPath();
  }

  /** Create a chonk proof from msgpack-serialized execution steps (from `serializePrivateExecutionSteps`). */
  async createChonkProof(data: Uint8Array): Promise<ChonkProofWithPublicInputs> {
    logger.info("Creating chonk proof", { bytes: data.byteLength });
    const start = performance.now();

    const tmpDir = await mkdtemp(join(tmpdir(), "tee-rex-prove-"));
    try {
      const inputPath = join(tmpDir, "ivc-inputs.msgpack");
      const outputDir = join(tmpDir, "output");
      await mkdir(outputDir, { recursive: true });
      await writeFile(inputPath, data);

      await execFileAsync(this.#bbPath, [
        "prove",
        "--scheme",
        "chonk",
        "--ivc_inputs_path",
        inputPath,
        "-o",
        outputDir,
      ]);

      const proofPath = join(outputDir, "proof");
      const rawProof = await readFile(proofPath);

      // Prepend 4-byte field count header (big-endian u32) — same format as
      // ChonkProofWithPublicInputs.toBuffer() and the accelerator.
      const numFields = rawProof.length / 32;
      const header = Buffer.alloc(4);
      header.writeUInt32BE(numFields);
      const proofWithHeader = Buffer.concat([header, rawProof]);

      const result = ChonkProofWithPublicInputs.fromBuffer(proofWithHeader);
      const durationMs = Math.round(performance.now() - start);
      logger.info("Chonk proof created", { durationMs });
      return result;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
