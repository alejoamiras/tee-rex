import { chmodSync, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { versionBbPath, versionsBaseDir } from "./bb-versions.js";

const logger = getLogger(["tee-rex", "server", "bb-download"]);

/** Construct the GitHub releases download URL for a bb binary. */
export function bbDownloadUrl(version: string, platform = "amd64-linux"): string {
  return `https://github.com/AztecProtocol/aztec-packages/releases/download/v${version}/barretenberg-${platform}.tar.gz`;
}

/**
 * Download a bb binary from GitHub releases.
 *
 * Returns the path to the bb binary. Skips download if already cached.
 * Uses atomic rename to prevent partial downloads from being used.
 */
export async function downloadBb(version: string, platform = "amd64-linux"): Promise<string> {
  const bbPath = versionBbPath(version);
  if (existsSync(bbPath)) {
    logger.info("bb already cached", { version, bbPath });
    return bbPath;
  }

  const url = bbDownloadUrl(version, platform);
  logger.info("Downloading bb", { version, url });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download bb v${version}: ${response.status} ${response.statusText}`);
  }

  const baseDir = versionsBaseDir();
  await mkdir(baseDir, { recursive: true });

  const tmpDir = join(baseDir, `.${version}.tmp`);
  const versionDir = join(baseDir, version);

  // Clean up any previous incomplete download
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  // Write tarball to temp location
  const tarballPath = join(tmpDir, "bb.tar.gz");
  await Bun.write(tarballPath, response);

  // Extract — tarball contains bb at the root
  const proc = Bun.spawn(["tar", "-xzf", tarballPath, "-C", tmpDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to extract bb tarball: ${stderr}`);
  }

  // chmod 755 the bb binary
  const extractedBb = join(tmpDir, "bb");
  if (!existsSync(extractedBb)) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`bb binary not found in extracted tarball at ${extractedBb}`);
  }
  chmodSync(extractedBb, 0o755);

  // Atomic rename: tmp → final
  try {
    await rename(tmpDir, versionDir);
  } catch {
    // Target exists (race condition) — overwrite
    await rm(versionDir, { recursive: true, force: true });
    await rename(tmpDir, versionDir);
  }

  logger.info("bb downloaded and cached", { version, bbPath });
  return bbPath;
}
