import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as openpgp from "openpgp";
import { createEnclaveServer, type EnclaveDependencies } from "./enclave.js";
import { StandardAttestationService } from "./lib/attestation-service.js";
import { BbHashCache } from "./lib/bb-hash.js";
import { EncryptionService } from "./lib/encryption-service.js";

/** Create a fake bb script that writes known marker bytes as proof output. */
function createFakeBb(dir: string, marker: Uint8Array): string {
  const bbPath = join(dir, "bb");
  writeFileSync(
    bbPath,
    `#!/bin/bash
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

describe("Enclave service", () => {
  let tmpDir: string;
  let origVersionsDir: string | undefined;
  let origBbPath: string | undefined;

  const v1Marker = new Uint8Array(64).fill(0xaa);

  let server: ReturnType<typeof createEnclaveServer>;
  let baseUrl: string;
  let encryption: EncryptionService;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "enclave-test-"));
    origVersionsDir = process.env.BB_VERSIONS_DIR;
    origBbPath = process.env.BB_BINARY_PATH;

    // Set up a fake bb in the versions dir
    const v1Dir = join(tmpDir, "versions", "1.0.0-nightly.20260301");
    mkdirSync(v1Dir, { recursive: true });
    createFakeBb(v1Dir, v1Marker);

    process.env.BB_VERSIONS_DIR = join(tmpDir, "versions");
    process.env.BB_BINARY_PATH = join(v1Dir, "bb");

    encryption = new EncryptionService();
    const bbHashCache = new BbHashCache();

    const deps: EnclaveDependencies = {
      encryption,
      attestation: new StandardAttestationService(),
      bbHashCache,
      createProver: () => {
        const { ProverService } = require("./lib/prover-service.js");
        return new ProverService();
      },
    };

    // Use port 0 to get a random available port
    server = createEnclaveServer(deps, { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
    if (origVersionsDir === undefined) delete process.env.BB_VERSIONS_DIR;
    else process.env.BB_VERSIONS_DIR = origVersionsDir;
    if (origBbPath === undefined) delete process.env.BB_BINARY_PATH;
    else process.env.BB_BINARY_PATH = origBbPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GET /health", () => {
    test("returns ok status", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; versions: unknown[] };
      expect(body.status).toBe("ok");
      expect(Array.isArray(body.versions)).toBe(true);
    });
  });

  describe("GET /public-key", () => {
    test("returns a PGP public key", async () => {
      const res = await fetch(`${baseUrl}/public-key`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { publicKey: string };
      expect(body.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    });
  });

  describe("GET /attestation", () => {
    test("returns standard attestation with public key", async () => {
      const res = await fetch(`${baseUrl}/attestation`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { mode: string; publicKey: string };
      expect(body.mode).toBe("standard");
      expect(body.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    });
  });

  describe("POST /upload-bb", () => {
    test("uploads a bb binary and returns version + hash", async () => {
      const fakeBb = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const res = await fetch(`${baseUrl}/upload-bb`, {
        method: "POST",
        headers: { "x-bb-version": "9.9.9-test" },
        body: fakeBb,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { version: string; sha256: string };
      expect(body.version).toBe("9.9.9-test");
      expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test("uploaded version appears in health", async () => {
      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json()) as {
        versions: { version: string; sha256: string }[];
      };
      expect(body.versions.some((v) => v.version === "9.9.9-test")).toBe(true);
    });

    test("returns 400 when x-bb-version header missing", async () => {
      const res = await fetch(`${baseUrl}/upload-bb`, {
        method: "POST",
        body: Buffer.from([1, 2, 3]),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("x-bb-version");
    });

    test("returns 400 for empty body", async () => {
      const res = await fetch(`${baseUrl}/upload-bb`, {
        method: "POST",
        headers: { "x-bb-version": "1.0.0" },
        body: new ArrayBuffer(0),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /prove", () => {
    test("decrypts and proves with encrypted payload", async () => {
      const publicKey = await encryption.getEncryptionPublicKey();
      const fakeMsgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(fakeMsgpack, publicKey);

      const res = await fetch(`${baseUrl}/prove`, {
        method: "POST",
        headers: { "x-aztec-version": "1.0.0-nightly.20260301" },
        body: Buffer.from(encrypted),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      expect(body.proof).toBeDefined();

      // Verify timing headers
      expect(res.headers.get("x-prove-duration-ms")).toBeDefined();
      expect(res.headers.get("x-decrypt-duration-ms")).toBeDefined();
      expect(Number(res.headers.get("x-prove-duration-ms"))).toBeGreaterThanOrEqual(0);
      expect(Number(res.headers.get("x-decrypt-duration-ms"))).toBeGreaterThanOrEqual(0);

      // Verify proof content — first 4 bytes are field count header, then v1 marker (0xAA)
      const proofBytes = Buffer.from(body.proof, "base64");
      expect(proofBytes[0]).toBe(0);
      expect(proofBytes[1]).toBe(0);
      expect(proofBytes[2]).toBe(0);
      expect(proofBytes[3]).toBe(2); // 64 bytes = 2 fields
      expect(proofBytes[4]).toBe(0xaa);
    });

    test("decrypts and proves with JSON { data: base64 } payload", async () => {
      const publicKey = await encryption.getEncryptionPublicKey();
      const fakeMsgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const encrypted = await encryptForKey(fakeMsgpack, publicKey);
      const base64Data = Buffer.from(encrypted).toString("base64");

      const res = await fetch(`${baseUrl}/prove`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aztec-version": "1.0.0-nightly.20260301",
        },
        body: JSON.stringify({ data: base64Data }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { proof: string };
      expect(body.proof).toBeDefined();

      const proofBytes = Buffer.from(body.proof, "base64");
      expect(proofBytes[0]).toBe(0);
      expect(proofBytes[1]).toBe(0);
      expect(proofBytes[2]).toBe(0);
      expect(proofBytes[3]).toBe(2);
      expect(proofBytes[4]).toBe(0xaa);
    });

    test("returns 400 for bad encryption", async () => {
      const res = await fetch(`${baseUrl}/prove`, {
        method: "POST",
        body: Buffer.from([1, 2, 3, 4]),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("decrypt");
    });

    test("returns 400 for empty body", async () => {
      const res = await fetch(`${baseUrl}/prove`, {
        method: "POST",
        body: new ArrayBuffer(0),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for empty JSON data field", async () => {
      const res = await fetch(`${baseUrl}/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("expected { data: string }");
    });
  });

  describe("404", () => {
    test("returns 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /attestation with bb versions", () => {
    test("includes bbVersions from hash cache in attestation", async () => {
      // Upload a bb first to populate the hash cache
      const fakeBb = Buffer.from([0xca, 0xfe]);
      await fetch(`${baseUrl}/upload-bb`, {
        method: "POST",
        headers: { "x-bb-version": "8.8.8-attest-test" },
        body: fakeBb,
      });

      const res = await fetch(`${baseUrl}/attestation`);
      const body = (await res.json()) as {
        mode: string;
        bbVersions?: { version: string; sha256: string }[];
      };
      expect(body.mode).toBe("standard");
      expect(body.bbVersions).toBeDefined();
      expect(body.bbVersions!.some((v) => v.version === "8.8.8-attest-test")).toBe(true);
    });
  });
});
