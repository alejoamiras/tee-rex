/**
 * Update all @aztec/* version references across the repo.
 *
 * Usage: bun scripts/update-aztec-version.ts <version>
 * Example: bun scripts/update-aztec-version.ts 4.0.0-nightly.20260208
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+-nightly\.\d{8}$/;

const PACKAGE_JSON_FILES = [
  "packages/sdk/package.json",
  "packages/server/package.json",
  "packages/demo/package.json",
];

export function validateVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

export function updatePackageJson(content: string, newVersion: string): string {
  const pkg = JSON.parse(content);

  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [key, value] of Object.entries(deps)) {
      if (key.startsWith("@aztec/") && typeof value === "string" && VERSION_PATTERN.test(value)) {
        deps[key] = newVersion;
      }
    }
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

async function main() {
  const newVersion = process.argv[2];

  if (!newVersion) {
    console.error("Usage: bun scripts/update-aztec-version.ts <version>");
    console.error("Example: bun scripts/update-aztec-version.ts 4.0.0-nightly.20260208");
    process.exit(1);
  }

  if (!validateVersion(newVersion)) {
    console.error(`Invalid version format: "${newVersion}". Expected: X.Y.Z-nightly.YYYYMMDD`);
    process.exit(1);
  }

  let updatedFiles = 0;

  // Update package.json files
  for (const filePath of PACKAGE_JSON_FILES) {
    const file = Bun.file(filePath);
    const original = await file.text();
    const updated = updatePackageJson(original, newVersion);
    if (updated !== original) {
      await Bun.write(filePath, updated);
      console.log(`Updated ${filePath}`);
      updatedFiles++;
    }
  }

  if (updatedFiles === 0) {
    console.log("All files already at target version. No changes needed.");
  } else {
    console.log(`\nDone. Updated ${updatedFiles} file(s) to ${newVersion}.`);
    console.log("Run 'bun install' to regenerate the lockfile.");
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
