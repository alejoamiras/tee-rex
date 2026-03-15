import type { BbVersionInfo } from "./enclave-protocol.js";

/** Compute the SHA256 hex digest of a bb binary on disk. */
export async function computeBbHash(bbPath: string): Promise<string> {
  const bytes = await Bun.file(bbPath).arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(hash).toString("hex");
}

/**
 * In-memory cache of bb version → SHA256 hash.
 * Used by the enclave to track uploaded binaries and include
 * their hashes in attestation user_data.
 */
export class BbHashCache {
  #cache = new Map<string, string>();

  set(version: string, sha256: string): void {
    this.#cache.set(version, sha256);
  }

  get(version: string): string | undefined {
    return this.#cache.get(version);
  }

  has(version: string): boolean {
    return this.#cache.has(version);
  }

  all(): BbVersionInfo[] {
    return Array.from(this.#cache.entries())
      .map(([version, sha256]) => ({ version, sha256 }))
      .sort((a, b) => a.version.localeCompare(b.version));
  }
}
