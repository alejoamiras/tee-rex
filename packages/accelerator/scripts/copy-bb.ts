/**
 * Extract the `bb` binary from `@aztec/bb.js` and copy it to `src-tauri/binaries/`
 * as a Tauri sidecar with the correct target-triple suffix.
 *
 * Tauri expects sidecars at `binaries/<name>-<target-triple>`.
 */
import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// --- Resolve bb binary from @aztec/bb.js ---
// Read the Aztec version from server's package.json, find the matching bb.js in bun's cache.
// We can't use createRequire or Bun.resolveSync across workspace packages reliably.

const serverPkg = JSON.parse(
  readFileSync(join(import.meta.dirname!, "..", "..", "server", "package.json"), "utf8"),
);
const aztecVersion: string =
  serverPkg.dependencies["@aztec/bb-prover"] ?? serverPkg.dependencies["@aztec/stdlib"];

const bunCache = join(import.meta.dirname!, "..", "..", "..", "node_modules", ".bun");
const arch = process.arch === "arm64" ? "arm64" : "amd64";
const os = process.platform === "darwin" ? "macos" : "linux";

// Find @aztec+bb.js@<version>* directories in bun cache
const bbJsDirPrefix = `@aztec+bb.js@${aztecVersion}`;
const candidates = readdirSync(bunCache).filter((d) => d.startsWith(bbJsDirPrefix));

if (candidates.length === 0) {
  console.error(`No @aztec/bb.js matching version ${aztecVersion} in ${bunCache}`);
  console.error(`Run 'bun install' first.`);
  process.exit(1);
}

// Use the first match (they all have the same bb binary for a given version)
const bbJsRoot = join(bunCache, candidates[0], "node_modules", "@aztec", "bb.js");
const bbSource = join(bbJsRoot, "build", `${arch}-${os}`, "bb");

if (!existsSync(bbSource)) {
  console.error(`bb binary not found at ${bbSource}`);
  process.exit(1);
}

// --- Map to Tauri target triple ---

function getTargetTriple(): string {
  const platform = process.platform;
  const nodeArch = process.arch;

  if (platform === "darwin") {
    return nodeArch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return nodeArch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

const targetTriple = getTargetTriple();
const binariesDir = join(import.meta.dirname!, "..", "src-tauri", "binaries");
const dest = join(binariesDir, `bb-${targetTriple}`);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(bbSource, dest);
chmodSync(dest, 0o755);

// Remove macOS quarantine attribute (prevents Gatekeeper from killing the binary)
if (process.platform === "darwin") {
  try {
    execSync(`xattr -d com.apple.quarantine "${dest}"`, { stdio: "ignore" });
  } catch {
    // Attribute may not exist, that's fine
  }
}

console.log(`Copied bb (${aztecVersion}) -> ${dest}`);
