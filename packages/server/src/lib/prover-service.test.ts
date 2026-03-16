import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyVersion, findBb, listCachedVersions, versionsToEvict } from "./bb-versions.js";

// ---------------------------------------------------------------------------
// classifyVersion — network tier classification
// ---------------------------------------------------------------------------

describe("classifyVersion", () => {
  test("nightly", () => expect(classifyVersion("5.0.0-nightly.20260307")).toBe("nightly"));
  test("testnet", () => expect(classifyVersion("5.0.0-rc.1")).toBe("testnet"));
  test("mainnet", () => expect(classifyVersion("5.0.0")).toBe("mainnet"));
  test("unknown prerelease defaults to mainnet", () =>
    expect(classifyVersion("1.2.3")).toBe("mainnet"));
});

// ---------------------------------------------------------------------------
// versionsToEvict — retention policy
// ---------------------------------------------------------------------------

describe("versionsToEvict", () => {
  test("evicts excess nightlies (keep 2)", () => {
    const cached = [
      "5.0.0-nightly.20260301",
      "5.0.0-nightly.20260302",
      "5.0.0-nightly.20260303",
      "5.0.0-nightly.20260304",
    ];
    const evicted = versionsToEvict(cached, "5.0.0-nightly.20260304");
    expect(evicted).toHaveLength(2);
    expect(evicted).toContain("5.0.0-nightly.20260301");
    expect(evicted).toContain("5.0.0-nightly.20260302");
  });

  test("bundled version never evicted", () => {
    const cached = [
      "5.0.0-nightly.20260301",
      "5.0.0-nightly.20260302",
      "5.0.0-nightly.20260303",
      "5.0.0-nightly.20260304",
    ];
    const evicted = versionsToEvict(cached, "5.0.0-nightly.20260301");
    expect(evicted).not.toContain("5.0.0-nightly.20260301");
    expect(evicted).toHaveLength(2);
  });

  test("mainnet versions never evicted", () => {
    const cached = ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0"];
    expect(versionsToEvict(cached, "5.0.0")).toHaveLength(0);
  });

  test("mixed tiers evict independently", () => {
    const cached = [
      "5.0.0-nightly.20260301",
      "5.0.0-nightly.20260302",
      "5.0.0-nightly.20260303",
      "5.0.0-rc.1",
      "5.0.0",
    ];
    const evicted = versionsToEvict(cached, "5.0.0");
    // Only 1 nightly evicted (3 cached, keep 2)
    expect(evicted).toHaveLength(1);
    expect(evicted).toContain("5.0.0-nightly.20260301");
  });
});

// ---------------------------------------------------------------------------
// listCachedVersions + findBb — with temp directory
// ---------------------------------------------------------------------------

describe("listCachedVersions", () => {
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-versions-test-"));
    origEnv = process.env.BB_VERSIONS_DIR;
    process.env.BB_VERSIONS_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.BB_VERSIONS_DIR;
    else process.env.BB_VERSIONS_DIR = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array for empty directory", () => {
    expect(listCachedVersions()).toEqual([]);
  });

  test("lists directories containing a bb file", () => {
    const v1 = join(tmpDir, "5.0.0-nightly.20260301");
    const v2 = join(tmpDir, "5.0.0-nightly.20260302");
    const incomplete = join(tmpDir, "5.0.0-incomplete");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "bb"), "fake");
    mkdirSync(v2, { recursive: true });
    writeFileSync(join(v2, "bb"), "fake");
    mkdirSync(incomplete, { recursive: true });
    // incomplete has no bb file

    const versions = listCachedVersions();
    expect(versions).toEqual(["5.0.0-nightly.20260301", "5.0.0-nightly.20260302"]);
  });
});

describe("findBb", () => {
  let tmpDir: string;
  let origVersionsDir: string | undefined;
  let origBbPath: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-find-test-"));
    origVersionsDir = process.env.BB_VERSIONS_DIR;
    origBbPath = process.env.BB_BINARY_PATH;
    process.env.BB_VERSIONS_DIR = tmpDir;
    delete process.env.BB_BINARY_PATH;
  });

  afterEach(() => {
    if (origVersionsDir === undefined) delete process.env.BB_VERSIONS_DIR;
    else process.env.BB_VERSIONS_DIR = origVersionsDir;
    if (origBbPath === undefined) delete process.env.BB_BINARY_PATH;
    else process.env.BB_BINARY_PATH = origBbPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("BB_BINARY_PATH override takes priority", () => {
    const exe = Bun.which("bun")!; // guaranteed to exist
    process.env.BB_BINARY_PATH = exe;
    expect(findBb()).toBe(exe);
  });

  test("finds bb from version cache", () => {
    const version = "5.0.0-test";
    const dir = join(tmpDir, version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bb"), "fake-bb");
    expect(findBb(version)).toBe(join(dir, "bb"));
  });

  test("falls through to node_modules when version not cached", () => {
    // Without a cached version or BB_BINARY_PATH, should find bb from node_modules
    const bbPath = findBb();
    expect(bbPath).toContain("bb");
  });

  test("falls through to node_modules when version not cached", () => {
    // Requesting a non-cached version should still find bb via node_modules fallback
    const bbPath = findBb("99.99.99-nonexistent");
    expect(bbPath).toContain("bb");
  });
});

// ---------------------------------------------------------------------------
// bb binary integration tests — uses the real bb from node_modules
// ---------------------------------------------------------------------------

describe("bb binary", () => {
  test("can be invoked with --version", async () => {
    const bbPath = findBb();
    const proc = Bun.spawn([bbPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).not.toBeNull();
  });

  test("fails gracefully with invalid input", async () => {
    const bbPath = findBb();
    const { mkdtemp, rm, mkdir } = await import("node:fs/promises");

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
      expect(exitCode).not.toBe(0);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
