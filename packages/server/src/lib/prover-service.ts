import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { findBb, listCachedVersions } from "./bb-versions.js";

const logger = getLogger(["tee-rex", "server", "prover"]);

export class ProverService {
  #defaultBbPath: string;

  constructor() {
    // Resolve the default bb path eagerly at startup (fails fast if bb is missing)
    this.#defaultBbPath = findBb();
    logger.info("ProverService initialized", {
      defaultBb: this.#defaultBbPath,
      cachedVersions: listCachedVersions(),
    });
  }

  /**
   * Create a chonk proof from msgpack-serialized execution steps.
   * When `version` is specified, uses the cached bb binary for that version.
   */
  async createChonkProof(data: Uint8Array, version?: string): Promise<Buffer> {
    const bbPath = version ? findBb(version) : this.#defaultBbPath;
    logger.info("Creating chonk proof", {
      bytes: data.byteLength,
      version: version ?? "default",
      bbPath,
    });
    const start = performance.now();

    const tmpDir = await mkdtemp(join(tmpdir(), "tee-rex-prove-"));
    try {
      const inputPath = join(tmpDir, "ivc-inputs.msgpack");
      const outputDir = join(tmpDir, "output");
      await mkdir(outputDir, { recursive: true });
      await Bun.write(inputPath, data);

      const proc = Bun.spawn(
        [bbPath, "prove", "--scheme", "chonk", "--ivc_inputs_path", inputPath, "-o", outputDir],
        { stdout: "pipe", stderr: "pipe" },
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`bb prove failed (exit ${exitCode}): ${stderr}`);
      }

      const rawProof = new Uint8Array(await Bun.file(join(outputDir, "proof")).arrayBuffer());

      // Prepend 4-byte field count header (big-endian u32) — same format as
      // ChonkProofWithPublicInputs.fromBuffer() expects and the accelerator produces.
      const numFields = rawProof.length / 32;
      const header = Buffer.alloc(4);
      header.writeUInt32BE(numFields);
      const proofWithHeader = Buffer.concat([header, rawProof]);

      const durationMs = Math.round(performance.now() - start);
      logger.info("Chonk proof created", { durationMs, version: version ?? "default" });
      return proofWithHeader;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
