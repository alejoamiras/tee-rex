import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as openpgp from "openpgp";
import { Base64 } from "ox";
import { type AppDependencies, createApp } from "../index.js";
import { StandardAttestationService } from "./attestation-service.js";
import { EncryptionService } from "./encryption-service.js";

/**
 * Integration tests for multi-version bb routing.
 *
 * Uses fake bb scripts that write version-specific marker bytes as proof output.
 * This validates the full flow: request → version header → bb selection → proof response.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake bb script that writes a known marker to the proof output. */
function createFakeBb(dir: string, marker: Uint8Array): string {
  const bbPath = join(dir, "bb");
  // The script receives: bb prove --scheme chonk --ivc_inputs_path <path> -o <outputDir>
  // It writes the marker bytes to <outputDir>/proof
  writeFileSync(
    bbPath,
    `#!/bin/bash
# Fake bb binary — writes marker bytes as proof
OUTPUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUTPUT_DIR="$2"; shift 2;;
    *) shift;;
  esac
done
if [ -z "$OUTPUT_DIR" ]; then
  echo "ERROR: no -o flag" >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
printf '${Array.from(marker)
      .map((b) => `\\x${b.toString(16).padStart(2, "0")}`)
      .join("")}' > "$OUTPUT_DIR/proof"
`,
  );
  chmodSync(bbPath, 0o755);
  return bbPath;
}

async function encryptForKey(data: Uint8Array, publicKeyArmored: string): Promise<Uint8Array> {
  const message = await openpgp.createMessage({ binary: data });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: await openpgp.readKey({ armoredKey: publicKeyArmored }),
  });
  const unarmored = await openpgp.unarmor(encrypted);
  return unarmored.data as Uint8Array;
}

async function startTestServer(app: ReturnType<typeof createApp>) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://localhost:${port}`, close: () => server.close() });
    });
  });
}

// ---------------------------------------------------------------------------
// Test setup: fake bb versions + real encryption, fake prover that uses findBb
// ---------------------------------------------------------------------------

describe("Multi-version bb routing", () => {
  let tmpDir: string;
  let origVersionsDir: string | undefined;
  let origBbPath: string | undefined;
  // Marker bytes: 64 bytes (2 fields × 32 bytes) so the header math works
  const v1Marker = new Uint8Array(64).fill(0xaa);
  const v2Marker = new Uint8Array(64).fill(0xbb);

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "multi-version-test-"));
    origVersionsDir = process.env.BB_VERSIONS_DIR;
    origBbPath = process.env.BB_BINARY_PATH;

    // Set up version cache with two fake bb binaries
    const v1Dir = join(tmpDir, "1.0.0-nightly.20260301");
    const v2Dir = join(tmpDir, "2.0.0-nightly.20260302");
    mkdirSync(v1Dir, { recursive: true });
    mkdirSync(v2Dir, { recursive: true });
    createFakeBb(v1Dir, v1Marker);
    createFakeBb(v2Dir, v2Marker);

    process.env.BB_VERSIONS_DIR = tmpDir;
    // Set BB_BINARY_PATH to v1 as the default (so ProverService constructor doesn't fail)
    process.env.BB_BINARY_PATH = join(v1Dir, "bb");
  });

  afterAll(() => {
    if (origVersionsDir === undefined) delete process.env.BB_VERSIONS_DIR;
    else process.env.BB_VERSIONS_DIR = origVersionsDir;
    if (origBbPath === undefined) delete process.env.BB_BINARY_PATH;
    else process.env.BB_BINARY_PATH = origBbPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestApp() {
    const encryption = new EncryptionService();
    const attestation = new StandardAttestationService();
    // Use the real ProverService which will call findBb with the version
    const { ProverService } = require("./prover-service.js");
    const prover = new ProverService();
    const deps = { prover, encryption, attestation } as unknown as AppDependencies;
    const app = createApp(deps);
    return { app, encryption };
  }

  test("routes to correct bb based on x-aztec-version header", async () => {
    const { app, encryption } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const publicKey = await encryption.getEncryptionPublicKey();
      const payload = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(payload, publicKey);
      const encryptedBase64 = Base64.fromBytes(encrypted);

      // Request with v2 version header
      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aztec-version": "2.0.0-nightly.20260302",
        },
        body: JSON.stringify({ data: encryptedBase64 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      const proofBytes = Base64.toBytes(body.proof as `0x${string}`);
      // First 4 bytes are the field count header (2 fields = 0x00000002)
      expect(proofBytes[0]).toBe(0);
      expect(proofBytes[1]).toBe(0);
      expect(proofBytes[2]).toBe(0);
      expect(proofBytes[3]).toBe(2);
      // Remaining 64 bytes should be the v2 marker (0xBB fill)
      expect(proofBytes[4]).toBe(0xbb);
      expect(proofBytes[67]).toBe(0xbb);
    } finally {
      close();
    }
  });

  test("uses default bb when no version header", async () => {
    const { app, encryption } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const publicKey = await encryption.getEncryptionPublicKey();
      const payload = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(payload, publicKey);
      const encryptedBase64 = Base64.fromBytes(encrypted);

      const res = await fetch(`${url}/prove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: encryptedBase64 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      const proofBytes = Base64.toBytes(body.proof as `0x${string}`);
      // Default (BB_BINARY_PATH) points to v1 → 0xAA fill
      expect(proofBytes[4]).toBe(0xaa);
    } finally {
      close();
    }
  });

  test("GET /health lists cached versions", async () => {
    const { app } = createTestApp();
    const { url, close } = await startTestServer(app);

    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; available_versions: string[] };
      expect(body.status).toBe("ok");
      expect(body.available_versions).toContain("1.0.0-nightly.20260301");
      expect(body.available_versions).toContain("2.0.0-nightly.20260302");
    } finally {
      close();
    }
  });

  test("returns 500 for unknown version with no fallback", async () => {
    // Temporarily remove BB_BINARY_PATH fallback so missing versions actually fail
    const origPath = process.env.BB_BINARY_PATH;
    delete process.env.BB_BINARY_PATH;

    try {
      // Need to construct app without ProverService (which calls findBb in constructor)
      // Instead, use a mock prover that simulates the version-not-found error
      const encryption = new EncryptionService();
      const attestation = new StandardAttestationService();
      const prover = {
        createChonkProof: mock((_data: Uint8Array, version?: string) => {
          if (version === "99.99.99") {
            throw new Error("bb binary not found for version 99.99.99");
          }
          return Promise.resolve(Buffer.from("fake"));
        }),
      };
      const app = createApp({
        prover,
        encryption,
        attestation,
      } as unknown as AppDependencies);
      const { url, close } = await startTestServer(app);

      try {
        const publicKey = await encryption.getEncryptionPublicKey();
        const payload = new Uint8Array([0x93, 0x01]);
        const encrypted = await encryptForKey(payload, publicKey);

        const res = await fetch(`${url}/prove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-aztec-version": "99.99.99",
          },
          body: JSON.stringify({ data: Base64.fromBytes(encrypted) }),
        });

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("Internal server error");
      } finally {
        close();
      }
    } finally {
      process.env.BB_BINARY_PATH = origPath;
    }
  });
});
