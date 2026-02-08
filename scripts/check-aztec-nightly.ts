/**
 * Check npm for the latest Aztec nightly and compare with current.
 *
 * Usage: bun scripts/check-aztec-nightly.ts
 * Output: JSON with { current, latest, needsUpdate }
 */

const AZTEC_PACKAGES = [
  "@aztec/accounts",
  "@aztec/aztec.js",
  "@aztec/bb-prover",
  "@aztec/foundation",
  "@aztec/noir-acvm_js",
  "@aztec/noir-contracts.js",
  "@aztec/noir-noirc_abi",
  "@aztec/pxe",
  "@aztec/simulator",
  "@aztec/stdlib",
  "@aztec/test-wallet",
];

async function getCurrentVersion(): Promise<string> {
  const sdkPkg = await Bun.file("packages/sdk/package.json").json();
  const version = sdkPkg.devDependencies?.["@aztec/aztec.js"] ?? sdkPkg.dependencies?.["@aztec/aztec.js"];
  if (!version) throw new Error("Could not find @aztec/aztec.js in packages/sdk/package.json");
  return version;
}

async function getLatestNightly(): Promise<string> {
  const proc = Bun.spawn(["npm", "view", "@aztec/aztec.js", "dist-tags", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`npm view failed: ${stderr}`);
  }
  const tags = JSON.parse(output);
  const nightly = tags.nightly;
  if (!nightly) throw new Error("No 'nightly' dist-tag found for @aztec/aztec.js");
  return nightly;
}

async function verifyAllPackagesExist(version: string): Promise<{ allExist: boolean; missing: string[] }> {
  const missing: string[] = [];

  await Promise.all(
    AZTEC_PACKAGES.map(async (pkg) => {
      const proc = Bun.spawn(["npm", "view", `${pkg}@${version}`, "version", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        missing.push(pkg);
      }
    }),
  );

  return { allExist: missing.length === 0, missing };
}

async function main() {
  const current = await getCurrentVersion();
  const latest = await getLatestNightly();

  if (current === latest) {
    console.log(JSON.stringify({ current, latest, needsUpdate: false }));
    return;
  }

  const { allExist, missing } = await verifyAllPackagesExist(latest);

  if (!allExist) {
    console.error(`Warning: Not all packages available at ${latest}. Missing: ${missing.join(", ")}`);
    console.log(JSON.stringify({ current, latest, needsUpdate: false, missing }));
    return;
  }

  console.log(JSON.stringify({ current, latest, needsUpdate: true }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
