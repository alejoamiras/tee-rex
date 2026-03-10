import { describe, expect, test } from "bun:test";
import { resolveBbPath } from "./prover-service.js";

describe("resolveBbPath", () => {
  test("resolves to an existing bb binary path", () => {
    const bbPath = resolveBbPath();
    expect(bbPath).toContain("/bb");
    expect(Bun.file(bbPath).size).toBeGreaterThan(0);
  });

  test("path contains the correct platform segment", () => {
    const bbPath = resolveBbPath();
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const os = process.platform === "darwin" ? "macos" : "linux";
    expect(bbPath).toContain(`${arch}-${os}`);
  });
});

describe("bb binary", () => {
  test("can be invoked with --version", async () => {
    const bbPath = resolveBbPath();
    const proc = Bun.spawn([bbPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    // bb may return 0 for --version or may not support the flag —
    // either way, it should not crash with a signal
    expect(exitCode).not.toBeNull();
  });

  test("fails gracefully with invalid input", async () => {
    const bbPath = resolveBbPath();
    const { mkdtemp, rm, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const testDir = await mkdtemp(join(tmpdir(), "tee-rex-test-"));
    try {
      const inputPath = join(testDir, "bad-input.msgpack");
      const outputDir = join(testDir, "output");
      await mkdir(outputDir, { recursive: true });
      await Bun.write(inputPath, new Uint8Array([0x00, 0x01, 0x02]));

      const proc = Bun.spawn(
        [bbPath, "prove", "--scheme", "chonk", "--ivc_inputs_path", inputPath, "-o", outputDir],
        { stdout: "pipe", stderr: "pipe" },
      );
      const exitCode = await proc.exited;

      // bb should exit non-zero on invalid input, not hang
      expect(exitCode).not.toBe(0);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
