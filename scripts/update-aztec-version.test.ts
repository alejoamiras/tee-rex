import { describe, expect, test } from "bun:test";
import { updatePackageJson, updateWorkflowYaml, validateVersion } from "./update-aztec-version";

describe("validateVersion", () => {
  test("accepts valid nightly versions", () => {
    expect(validateVersion("4.0.0-nightly.20260204")).toBe(true);
    expect(validateVersion("4.0.0-nightly.20260208")).toBe(true);
    expect(validateVersion("5.1.3-nightly.20270101")).toBe(true);
  });

  test("rejects invalid formats", () => {
    expect(validateVersion("garbage")).toBe(false);
    expect(validateVersion("4.0.0")).toBe(false);
    expect(validateVersion("4.0.0-nightly")).toBe(false);
    expect(validateVersion("4.0.0-nightly.abc")).toBe(false);
    expect(validateVersion("nightly.20260204")).toBe(false);
    expect(validateVersion("")).toBe(false);
  });
});

describe("updatePackageJson", () => {
  const samplePkg = JSON.stringify(
    {
      name: "test-pkg",
      dependencies: {
        "@aztec/bb-prover": "4.0.0-nightly.20260204",
        "@aztec/stdlib": "4.0.0-nightly.20260204",
        "openpgp": "6.1.1",
      },
      devDependencies: {
        "@aztec/aztec.js": "4.0.0-nightly.20260204",
        "@types/ms": "^0.7.34",
      },
    },
    null,
    2,
  );

  test("updates @aztec/* deps to new version", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-nightly.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.dependencies["@aztec/bb-prover"]).toBe("4.0.0-nightly.20260208");
    expect(parsed.dependencies["@aztec/stdlib"]).toBe("4.0.0-nightly.20260208");
    expect(parsed.devDependencies["@aztec/aztec.js"]).toBe("4.0.0-nightly.20260208");
  });

  test("preserves non-aztec deps", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-nightly.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.dependencies.openpgp).toBe("6.1.1");
    expect(parsed.devDependencies["@types/ms"]).toBe("^0.7.34");
  });

  test("preserves package name and other fields", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-nightly.20260208");
    const parsed = JSON.parse(result);

    expect(parsed.name).toBe("test-pkg");
  });

  test("is idempotent with current version", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-nightly.20260204");
    expect(result).toBe(`${samplePkg}\n`);
  });

  test("adds trailing newline", () => {
    const result = updatePackageJson(samplePkg, "4.0.0-nightly.20260208");
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
  });
});

describe("updateWorkflowYaml", () => {
  const sampleEnvYaml = `name: Nightly
on: push

jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      AZTEC_VERSION: "4.0.0-nightly.20260204"
    steps:
      - run: echo $AZTEC_VERSION`;

  const sampleWithYaml = `name: SDK
on: push

jobs:
  e2e:
    uses: ./.github/workflows/_e2e-sdk.yml
    with:
      aztec_version: "4.0.0-nightly.20260204"`;

  test("replaces AZTEC_VERSION env value", () => {
    const result = updateWorkflowYaml(sampleEnvYaml, "4.0.0-nightly.20260208");
    expect(result).toContain('AZTEC_VERSION: "4.0.0-nightly.20260208"');
    expect(result).not.toContain("20260204");
  });

  test("replaces aztec_version with: value", () => {
    const result = updateWorkflowYaml(sampleWithYaml, "4.0.0-nightly.20260208");
    expect(result).toContain('aztec_version: "4.0.0-nightly.20260208"');
    expect(result).not.toContain("20260204");
  });

  test("preserves key casing", () => {
    const envResult = updateWorkflowYaml(sampleEnvYaml, "4.0.0-nightly.20260208");
    expect(envResult).toContain("AZTEC_VERSION:");
    expect(envResult).not.toContain("aztec_version:");

    const withResult = updateWorkflowYaml(sampleWithYaml, "4.0.0-nightly.20260208");
    expect(withResult).toContain("aztec_version:");
    expect(withResult).not.toContain("AZTEC_VERSION:");
  });

  test("preserves other content", () => {
    const result = updateWorkflowYaml(sampleEnvYaml, "4.0.0-nightly.20260208");
    expect(result).toContain("name: Nightly");
    expect(result).toContain("echo $AZTEC_VERSION");
  });

  test("is idempotent with current version", () => {
    expect(updateWorkflowYaml(sampleEnvYaml, "4.0.0-nightly.20260204")).toBe(sampleEnvYaml);
    expect(updateWorkflowYaml(sampleWithYaml, "4.0.0-nightly.20260204")).toBe(sampleWithYaml);
  });
});
