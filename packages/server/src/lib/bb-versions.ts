import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["tee-rex", "server", "bb-versions"]);

// ---------------------------------------------------------------------------
// Network tier classification — same logic as accelerator (versions.rs)
// ---------------------------------------------------------------------------

export type NetworkTier = "nightly" | "testnet" | "mainnet";

const RETENTION_LIMITS: Record<NetworkTier, number | null> = {
  nightly: 2,
  testnet: 5,
  mainnet: null, // keep all
};

export function classifyVersion(version: string): NetworkTier {
  const prerelease = version.split("-").slice(1).join("-");
  if (prerelease.startsWith("nightly")) return "nightly";
  if (prerelease.startsWith("rc")) return "testnet";
  return "mainnet";
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Base directory for cached bb versions. Configurable via BB_VERSIONS_DIR env var. */
export function versionsBaseDir(): string {
  return process.env.BB_VERSIONS_DIR || join(homedir(), ".tee-rex", "versions");
}

/** Path to a specific cached bb binary. */
export function versionBbPath(version: string): string {
  return join(versionsBaseDir(), version, "bb");
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** List all cached bb versions by scanning the versions base directory. */
export function listCachedVersions(): string[] {
  const base = versionsBaseDir();
  if (!existsSync(base)) return [];
  const versions: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(base, entry.name, "bb"))) {
      versions.push(entry.name);
    }
  }
  return versions.sort();
}

// ---------------------------------------------------------------------------
// Resolution — port of accelerator's find_bb (bb.rs)
// ---------------------------------------------------------------------------

/**
 * Find the `bb` binary. When `version` is provided, the version cache is checked
 * first (before any fallback).
 *
 * Search order:
 * 0. Version cache (`{BB_VERSIONS_DIR}/{version}/bb`) — when version specified
 * 1. `BB_BINARY_PATH` env var — explicit default override (CI, testing)
 * 2. Bundled in `@aztec/bb.js` node_modules (current dev environment)
 * 3. `bb` on `$PATH`
 */
export function findBb(version?: string): string {
  // 0. Version cache — checked first when a specific version is requested
  if (version) {
    const cached = versionBbPath(version);
    if (existsSync(cached)) {
      logger.debug("Using cached bb", { version, bbPath: cached });
      return cached;
    }
  }

  // 1. BB_BINARY_PATH env var — explicit override for the default binary
  const envPath = process.env.BB_BINARY_PATH;
  if (envPath && existsSync(envPath)) {
    logger.debug("Using BB_BINARY_PATH override", { bbPath: envPath });
    return envPath;
  }

  // 2. Bundled in node_modules (@aztec/bb.js)
  try {
    const bbProverEntry = Bun.resolveSync("@aztec/bb-prover", ".");
    const bbJsEntry = Bun.resolveSync("@aztec/bb.js", bbProverEntry);
    const bbJsRoot = join(dirname(bbJsEntry), "..", "..");
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const os = process.platform === "darwin" ? "macos" : "linux";
    const bundled = join(bbJsRoot, "build", `${arch}-${os}`, "bb");
    if (existsSync(bundled)) {
      logger.debug("Using bundled bb from node_modules", { bbPath: bundled });
      return bundled;
    }
  } catch {
    // @aztec/bb-prover not installed — skip
  }

  // 3. bb on $PATH
  try {
    const proc = Bun.spawnSync(["which", "bb"]);
    if (proc.exitCode === 0) {
      const bbPath = proc.stdout.toString().trim();
      if (bbPath && existsSync(bbPath)) {
        logger.debug("Using bb from PATH", { bbPath });
        return bbPath;
      }
    }
  } catch {
    // which not available or bb not on PATH
  }

  throw new Error(
    version
      ? `bb binary not found for version ${version}. Checked: BB_BINARY_PATH, version cache, node_modules, PATH.`
      : "bb binary not found. Checked: BB_BINARY_PATH, node_modules, PATH.",
  );
}

// ---------------------------------------------------------------------------
// Retention / cleanup — port of accelerator's versions_to_evict (versions.rs)
// ---------------------------------------------------------------------------

/** Determine which cached versions should be evicted per the retention policy. */
export function versionsToEvict(cached: string[], bundledVersion?: string): string[] {
  const byTier = new Map<NetworkTier, string[]>();
  for (const v of cached) {
    const tier = classifyVersion(v);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(v);
  }

  const toEvict: string[] = [];
  for (const [tier, versions] of byTier) {
    const limit = RETENTION_LIMITS[tier];
    if (limit === null) continue; // mainnet: keep all

    const sorted = [...versions].sort();
    const candidates = bundledVersion ? sorted.filter((v) => v !== bundledVersion) : sorted;

    // Account for bundled version occupying a slot in this tier
    const bundledInTier = bundledVersion && versions.includes(bundledVersion);
    const effectiveLimit = bundledInTier ? limit - 1 : limit;

    while (candidates.length > effectiveLimit) {
      toEvict.push(candidates.shift()!);
    }
  }
  return toEvict;
}

/** Remove old cached versions per the retention policy. */
export function cleanupOldVersions(bundledVersion?: string): void {
  const cached = listCachedVersions();
  const toEvict = versionsToEvict(cached, bundledVersion);
  for (const version of toEvict) {
    const dir = join(versionsBaseDir(), version);
    try {
      rmSync(dir, { recursive: true, force: true });
      logger.info("Evicted old bb version", { version });
    } catch (err) {
      logger.warn("Failed to evict bb version", {
        version,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
