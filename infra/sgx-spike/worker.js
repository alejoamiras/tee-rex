#!/usr/bin/env node
// worker.js — SGX enclave worker for TEE-Rex (Phase 16).
//
// Runs inside Gramine SGX. Receives encrypted payloads via TCP,
// decrypts with openpgp, calls native bb prove, reads DCAP attestation
// quote, and returns the result.
//
// Wire format (both directions):
//   [4-byte big-endian length][JSON payload]
//
// Usage: gramine-sgx node /app/worker.js
// Env:   PORT (default 5000), CRS_PATH (default /crs)

"use strict";

const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const openpgp = require("openpgp");

const PORT = parseInt(process.env.PORT || "5000", 10);
const BB_PATH = "/app/bb";
const CRS_PATH = process.env.CRS_PATH || "/crs";

// Threading doesn't help in SGX per Phase 15E benchmarks
process.env.HARDWARE_CONCURRENCY = process.env.HARDWARE_CONCURRENCY || "1";

let privateKey;
let publicKeyArmored;
let server;

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

function prove(ivcInputsPath, outputDir) {
  const args = [
    "prove",
    "--scheme", "chonk",
    "--ivc_inputs_path", ivcInputsPath,
    "-o", outputDir,
  ];

  console.log(`[worker] Running: ${BB_PATH} ${args.join(" ")}`);
  const start = Date.now();
  execFileSync(BB_PATH, args, {
    stdio: "inherit",
    env: { ...process.env, CRS_PATH, HARDWARE_CONCURRENCY: "1" },
  });
  const elapsed = Date.now() - start;
  console.log(`[worker] Proof generated in ${elapsed}ms`);

  return fs.readFileSync(`${outputDir}/proof`);
}

function readDcapQuote(userData) {
  const reportDataPath = "/dev/attestation/user_report_data";
  const quotePath = "/dev/attestation/quote";

  try {
    // user_report_data is exactly 64 bytes — pad with zeros
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

/**
 * Read a length-prefixed message from a buffer.
 * Returns { message, remaining } or null if incomplete.
 */
function readLengthPrefixed(buffer) {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32BE(0);
  if (buffer.length < 4 + length) return null;
  return {
    message: buffer.subarray(4, 4 + length),
    remaining: buffer.subarray(4 + length),
  };
}

/** Write a length-prefixed JSON response and close the socket. */
function sendResponse(socket, response) {
  const payload = Buffer.from(JSON.stringify(response));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  socket.end(Buffer.concat([header, payload]));
}

function handleConnection(socket) {
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    const result = readLengthPrefixed(buffer);
    if (!result) return; // wait for more data

    buffer = result.remaining;
    processRequest(socket, result.message);
  });

  socket.on("error", (err) => {
    console.error(`[worker] Socket error: ${err.message}`);
  });
}

async function processRequest(socket, messageBuffer) {
  try {
    const request = JSON.parse(messageBuffer.toString());

    if (request.action === "health") {
      sendResponse(socket, { status: "ok" });
      return;
    }

    if (request.action === "get_public_key") {
      sendResponse(socket, { publicKey: publicKeyArmored });
      return;
    }

    if (request.action === "get_quote") {
      const userData = Buffer.from(request.userData, "base64");
      const quote = readDcapQuote(userData);
      if (!quote) {
        sendResponse(socket, { error: "DCAP attestation not available" });
        return;
      }
      sendResponse(socket, { quote: quote.toString("base64") });
      return;
    }

    if (request.action === "prove") {
      // 1. Decrypt the encrypted payload
      const encryptedPayload = Buffer.from(request.encryptedPayload, "base64");
      const plaintext = await decrypt(encryptedPayload);
      console.log(`[worker] Decrypted payload: ${plaintext.length} bytes`);

      // 2. Write the msgpack IVC inputs to a temp dir.
      //    The SDK sends pre-serialized msgpack (via serializePrivateExecutionSteps)
      //    containing [{functionName, bytecode, witness, vk}, ...] ready for bb CLI.
      const tmpDir = `/tmp/prove-${Date.now()}`;
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const ivcInputsPath = `${tmpDir}/ivc-inputs.msgpack`;
        fs.writeFileSync(ivcInputsPath, plaintext);
        console.log(`[worker] Wrote IVC inputs: ${plaintext.length} bytes`);

        // 3. Generate proof
        const rawProof = prove(ivcInputsPath, tmpDir);

        // bb CLI outputs raw field data (N × 32 bytes). ChonkProofWithPublicInputs.fromBuffer()
        // expects a 4-byte BE uint32 field count prefix followed by the field data.
        const fieldCount = rawProof.length / 32;
        const header = Buffer.alloc(4);
        header.writeUInt32BE(fieldCount, 0);
        const proof = Buffer.concat([header, rawProof]);
        console.log(`[worker] Proof: ${rawProof.length} raw bytes, ${fieldCount} fields, ${proof.length} total bytes`);

        sendResponse(socket, {
          proof: proof.toString("base64"),
        });
      } finally {
        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      return;
    }

    sendResponse(socket, { error: "Unknown action" });
  } catch (err) {
    console.error(`[worker] Error: ${err.message}`);
    sendResponse(socket, { error: err.message });
  }
}

async function main() {
  await initKeys();

  server = net.createServer(handleConnection);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[worker] SGX enclave worker listening on 127.0.0.1:${PORT}`);
    console.log(`[worker] Actions: get_public_key, get_quote, prove, health`);
  });
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`[worker] Received ${signal}, shutting down...`);
  if (server) {
    server.close(() => {
      console.log("[worker] Server closed.");
      process.exit(0);
    });
    // Force exit after 5 seconds if connections don't drain
    setTimeout(() => {
      console.error("[worker] Forced shutdown after timeout.");
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error(`[worker] Fatal: ${err.message}`);
  process.exit(1);
});
