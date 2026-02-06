import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import type { PrivateExecutionStep } from "@aztec/stdlib/kernel";
import { getLogger } from "@logtape/logtape";
import { lazyValue } from "./utils.js";

const logger = getLogger(["tee-rex", "server", "prover"]);

/**
 * Resolve the native Barretenberg binary path from the installed @aztec/bb.js package.
 * Falls back to undefined if the binary can't be found (will use WASM).
 */
function resolveBbPath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const bbProverPath = require.resolve("@aztec/bb-prover");
    const bbProverRequire = createRequire(bbProverPath);
    const bbJsEntry = bbProverRequire.resolve("@aztec/bb.js");
    const bbJsRoot = join(dirname(bbJsEntry), "..", "..");
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const os = process.platform === "darwin" ? "macos" : "linux";
    const bbPath = join(bbJsRoot, "build", `${arch}-${os}`, "bb");
    const fs = require("node:fs");
    if (fs.existsSync(bbPath)) {
      logger.info("Using native Barretenberg", { bbPath });
      return bbPath;
    }
    logger.warn("Native bb binary not found, will fall back to WASM", { bbPath });
  } catch (err) {
    logger.warn("Could not resolve native bb binary, will fall back to WASM", {
      error: String(err),
    });
  }
  return undefined;
}

export class ProverService {
  constructor() {
    setTimeout(() => this.#prover(), 1); // eagerly load the prover
  }

  #prover = lazyValue(async () => {
    const simulator = new WASMSimulator();
    const bbPath = resolveBbPath();
    const prover = new BBLazyPrivateKernelProver(simulator, {
      ...(bbPath ? { bbPath } : {}),
    });
    return prover;
  });

  async createChonkProof(executionSteps: PrivateExecutionStep[]) {
    logger.info("Creating chonk proof", { steps: executionSteps.length });
    const start = performance.now();
    const prover = await this.#prover();
    const result = await prover.createChonkProof(executionSteps);
    const durationMs = Math.round(performance.now() - start);
    logger.info("Chonk proof created", { durationMs, steps: executionSteps.length });
    return result;
  }
}
