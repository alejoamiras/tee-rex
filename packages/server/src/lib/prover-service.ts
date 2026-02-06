import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import type { PrivateExecutionStep } from "@aztec/stdlib/kernel";
import { getLogger } from "@logtape/logtape";
import { lazyValue } from "./utils.js";

const logger = getLogger(["tee-rex", "server", "prover"]);

export class ProverService {
  constructor() {
    setTimeout(() => this.#prover(), 1); // eagerly load the prover
  }

  #prover = lazyValue(async () => {
    const simulator = new WASMSimulator();
    const prover = new BBLazyPrivateKernelProver(simulator);
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
