import { BBLazyPrivateKernelProver } from "@aztec/bb-prover/client/lazy";
import { WASMSimulator } from "@aztec/simulator/client";
import type { PrivateExecutionStep } from "@aztec/stdlib/kernel";
import { lazyValue } from "./utils.js";

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
    const prover = await this.#prover();
    return await prover.createChonkProof(executionSteps);
  }
}
