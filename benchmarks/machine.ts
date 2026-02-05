/**
 * Machine metadata collection for benchmark results
 */

import { cpus, totalmem, hostname, platform, arch, release } from "os";

export interface MachineInfo {
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  cpuSpeed: number;
  totalMemoryGB: number;
  nodeVersion: string;
  bunVersion: string;
  timestamp: string;
}

/**
 * Collect machine metadata for benchmark identification
 */
export function getMachineInfo(): MachineInfo {
  const cpuInfo = cpus();
  const cpu = cpuInfo[0];

  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpuModel: cpu?.model || "unknown",
    cpuCores: cpuInfo.length,
    cpuSpeed: cpu?.speed || 0,
    totalMemoryGB: Math.round(totalmem() / (1024 * 1024 * 1024) * 10) / 10,
    nodeVersion: process.version,
    bunVersion: Bun.version,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate a short machine identifier for filenames
 */
export function getMachineId(): string {
  const info = getMachineInfo();
  const name = info.hostname.split(".")[0]?.toLowerCase() || "unknown";
  const cores = info.cpuCores;
  const mem = Math.round(info.totalMemoryGB);
  return `${name}-${cores}c-${mem}gb`;
}
