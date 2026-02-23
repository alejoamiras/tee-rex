#!/usr/bin/env node
// worker.js — Minimal Node.js enclave worker for SGX spike (Phase 15E).
//
// Runs inside Gramine SGX. Receives encrypted payloads via TCP,
// decrypts with openpgp, calls native bb prove, reads DCAP attestation
// quote, and returns the result.
//
// Usage: gramine-sgx node /app/worker.js
// Env:   PORT (default 5000), CRS_PATH (default /crs)

"use strict";

const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");
const openpgp = require("openpgp");

const PORT = parseInt(process.env.PORT || "5000", 10);
const BB_PATH = "/app/bb";
const CRS_PATH = process.env.CRS_PATH || "/crs";

let privateKey;
let publicKeyArmored;

async function initKeys() {
  console.log("[worker] Generating OpenPGP keypair inside enclave...");
  const { privateKey: privKey, publicKey: pubKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "p256",
    userIDs: [{ name: "SGX Enclave Worker", email: "enclave@tee-rex.dev" }],
  });
  privateKey = await openpgp.readPrivateKey({ armoredKey: privKey });
  publicKeyArmored = pubKey;
  console.log("[worker] Keypair generated. Private key stays in enclave.");
}

async function decrypt(encryptedData) {
  const message = await openpgp.readMessage({ binaryMessage: encryptedData });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: "binary",
  });
  return Buffer.from(data);
}

function prove(witnessPath, outputDir) {
  const cmd = [
    BB_PATH,
    "prove",
    "-b", `${outputDir}/acir.gz`,
    "-w", witnessPath,
    "-o", `${outputDir}/proof`,
  ].join(" ");

  console.log(`[worker] Running: ${cmd}`);
  const start = Date.now();
  execSync(cmd, { stdio: "inherit", env: { ...process.env, CRS_PATH } });
  const elapsed = Date.now() - start;
  console.log(`[worker] Proof generated in ${elapsed}ms`);

  return fs.readFileSync(`${outputDir}/proof`);
}

function readDcapQuote(userData) {
  // Write user report data (up to 64 bytes) — typically a hash of the proof
  const reportDataPath = "/dev/attestation/user_report_data";
  const quotePath = "/dev/attestation/quote";

  try {
    const padded = Buffer.alloc(64);
    userData.copy(padded, 0, 0, Math.min(userData.length, 64));
    fs.writeFileSync(reportDataPath, padded);
    const quote = fs.readFileSync(quotePath);
    console.log(`[worker] DCAP quote read: ${quote.length} bytes`);
    return quote;
  } catch (err) {
    console.error(`[worker] DCAP attestation failed: ${err.message}`);
    return null;
  }
}

function handleConnection(socket) {
  const chunks = [];

  socket.on("data", (chunk) => chunks.push(chunk));

  socket.on("end", async () => {
    try {
      const request = JSON.parse(Buffer.concat(chunks).toString());

      if (request.action === "get_public_key") {
        socket.end(JSON.stringify({ publicKey: publicKeyArmored }));
        return;
      }

      if (request.action === "prove") {
        // 1. Decrypt the encrypted witness
        const encryptedWitness = Buffer.from(request.encryptedPayload, "base64");
        const witness = await decrypt(encryptedWitness);
        console.log(`[worker] Decrypted witness: ${witness.length} bytes`);

        // 2. Write inputs to temp dir
        const tmpDir = `/tmp/prove-${Date.now()}`;
        fs.mkdirSync(tmpDir, { recursive: true });
        const witnessPath = `${tmpDir}/witness.gz`;
        fs.writeFileSync(witnessPath, witness);

        // Copy circuit artifacts if provided
        if (request.acir) {
          fs.writeFileSync(`${tmpDir}/acir.gz`, Buffer.from(request.acir, "base64"));
        }

        // 3. Generate proof
        const proof = prove(witnessPath, tmpDir);

        // 4. Get DCAP attestation quote (with proof hash as user data)
        const proofHash = crypto.createHash("sha256").update(proof).digest();
        const quote = readDcapQuote(proofHash);

        // 5. Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });

        // 6. Return result
        socket.end(
          JSON.stringify({
            proof: proof.toString("base64"),
            quote: quote ? quote.toString("base64") : null,
            proofHash: proofHash.toString("hex"),
          })
        );
        return;
      }

      socket.end(JSON.stringify({ error: "Unknown action" }));
    } catch (err) {
      console.error(`[worker] Error: ${err.message}`);
      socket.end(JSON.stringify({ error: err.message }));
    }
  });
}

async function main() {
  await initKeys();

  const server = net.createServer(handleConnection);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[worker] SGX enclave worker listening on 127.0.0.1:${PORT}`);
    console.log(`[worker] Public key available via { action: "get_public_key" }`);
  });
}

main().catch((err) => {
  console.error(`[worker] Fatal: ${err.message}`);
  process.exit(1);
});
