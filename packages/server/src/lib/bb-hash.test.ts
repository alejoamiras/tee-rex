import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BbHashCache, computeBbHash } from "./bb-hash.js";

describe("computeBbHash", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bb-hash-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns correct SHA256 for known input", async () => {
    const filePath = join(dir, "bb");
    await Bun.write(filePath, "hello world");
    const hash = await computeBbHash(filePath);
    // SHA256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  test("returns different hashes for different content", async () => {
    const path1 = join(dir, "bb1");
    const path2 = join(dir, "bb2");
    await Bun.write(path1, "binary-v1");
    await Bun.write(path2, "binary-v2");
    const hash1 = await computeBbHash(path1);
    const hash2 = await computeBbHash(path2);
    expect(hash1).not.toBe(hash2);
  });

  test("is deterministic", async () => {
    const filePath = join(dir, "bb");
    await Bun.write(filePath, "deterministic content");
    const hash1 = await computeBbHash(filePath);
    const hash2 = await computeBbHash(filePath);
    expect(hash1).toBe(hash2);
  });

  test("handles empty file", async () => {
    const filePath = join(dir, "bb");
    await Bun.write(filePath, "");
    const hash = await computeBbHash(filePath);
    // SHA256 of empty input
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("handles binary content", async () => {
    const filePath = join(dir, "bb");
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binary[i] = i;
    await Bun.write(filePath, binary);
    const hash = await computeBbHash(filePath);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("BbHashCache", () => {
  test("set and get", () => {
    const cache = new BbHashCache();
    cache.set("1.0.0", "abc123");
    expect(cache.get("1.0.0")).toBe("abc123");
  });

  test("get returns undefined for missing version", () => {
    const cache = new BbHashCache();
    expect(cache.get("1.0.0")).toBeUndefined();
  });

  test("has returns true for existing version", () => {
    const cache = new BbHashCache();
    cache.set("1.0.0", "abc123");
    expect(cache.has("1.0.0")).toBe(true);
  });

  test("has returns false for missing version", () => {
    const cache = new BbHashCache();
    expect(cache.has("1.0.0")).toBe(false);
  });

  test("all returns sorted version info", () => {
    const cache = new BbHashCache();
    cache.set("2.0.0", "hash2");
    cache.set("1.0.0", "hash1");
    cache.set("1.5.0", "hash15");
    expect(cache.all()).toEqual([
      { version: "1.0.0", sha256: "hash1" },
      { version: "1.5.0", sha256: "hash15" },
      { version: "2.0.0", sha256: "hash2" },
    ]);
  });

  test("all returns empty array when no versions", () => {
    const cache = new BbHashCache();
    expect(cache.all()).toEqual([]);
  });

  test("set overwrites existing entry", () => {
    const cache = new BbHashCache();
    cache.set("1.0.0", "old-hash");
    cache.set("1.0.0", "new-hash");
    expect(cache.get("1.0.0")).toBe("new-hash");
    expect(cache.all()).toHaveLength(1);
  });
});
