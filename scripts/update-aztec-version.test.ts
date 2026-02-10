import { describe, expect, test } from "bun:test";
import { updatePackageJson, validateVersion } from "./update-aztec-version";

describe("validateVersion", () => {
  test("accepts valid spartan versions", () => {
    expect(validateVersion("4.0.0-spartan.20260204")).toBe(true);
    expect(validateVersion("4.0.0-spartan.20260208")).toBe(true);
    expect(validateVersion("5.1.3-spartan.20270101")).toBe(true);
  });

  test("rejects invalid formats", () => {
    expect(validateVersion("garbage")).toBe(false);
    expect(validateVersion("4.0.0")).toBe(false);
    expect(validateVersion("4.0.0-spartan")).toBe(false);
    expect(validateVersion("4.0.0-spartan.abc")).toBe(false);
    expect(validateVersion("spartan.20260204")).toBe(false);
    expect(validateVersion("4.0.0-nightly.20260204")).toBe(false);
    expect(validateVersion("")).toBe(false);
  });
});

describe("updatePackageJson", () => {
  const samplePkg = JSON.stringify(
    {
      name: "test-pkg",
      dependencies: {
        "@aztec/bb-prover": "4.0.0-spartan.20260204",
        "@aztec/stdlib": "4.0.0-spartan.20260204",
        "openpgp": "6.1.1",
      },
      devDependencies: {
        "@aztec/aztec.js": "4.0.0-spartan.20260204",
        "@types/ms": "^0.7.34",
      },
    },
    null,
    2,
  );

  test("updates @aztec/* deps to new version", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-spartan.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.dependencies["@aztec/bb-prover"]).toBe("4.0.0-spartan.20260208");
    expect(parsed.dependencies["@aztec/stdlib"]).toBe("4.0.0-spartan.20260208");
    expect(parsed.devDependencies["@aztec/aztec.js"]).toBe("4.0.0-spartan.20260208");
  });

  test("preserves non-aztec deps", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-spartan.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.dependencies.openpgp).toBe("6.1.1");
    expect(parsed.devDependencies["@types/ms"]).toBe("^0.7.34");
  });

  test("preserves package name and other fields", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-spartan.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.name).toBe("test-pkg");
  });

  test("is idempotent with current version", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-spartan.20260204");
    expect(result).toBe(`${samplePkg}\n`);
  });

  test("adds trailing newline", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-spartan.20260208");
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
  });

  test("updates nightly deps to spartan version", () => {
    const nightlyPkg = JSON.stringify(
      {
        name: "test-pkg",
        dependencies: {
          "@aztec/bb-prover": "4.0.0-nightly.20260209",
        },
        devDependencies: {
          "@aztec/aztec.js": "4.0.0-nightly.20260209",
        },
      },
      null,
      2,
    );

    const result = updatePackageJson(nightlyPkg, "4.0.0-spartan.20260210");
    const parsed = JSON.parse(result);

    expect(parsed.dependencies["@aztec/bb-prover"]).toBe("4.0.0-spartan.20260210");
    expect(parsed.devDependencies["@aztec/aztec.js"]).toBe("4.0.0-spartan.20260210");
  });
});
