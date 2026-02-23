import * as net from "node:net";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["tee-rex", "server", "sgx-worker"]);

/**
 * TCP client for the Gramine SGX enclave worker.
 *
 * Communicates via length-prefixed JSON messages over TCP.
 * Each request opens a new connection (short-lived), matching the
 * worker's one-request-per-connection model.
 *
 * Wire format (both directions):
 *   [4-byte big-endian length][JSON payload]
 *
 * The client sends the request, then reads the length-prefixed response.
 * The server responds and closes the connection.
 */
export class SgxWorkerClient {
  constructor(
    private host: string,
    private port: number,
  ) {}

  /** Retrieve the enclave's OpenPGP public key (armored). */
  async getPublicKey(): Promise<string> {
    const response = await this.send({ action: "get_public_key" });
    if (typeof response.publicKey !== "string") {
      throw new Error("Invalid response from SGX worker: missing publicKey");
    }
    return response.publicKey;
  }

  /** Get a DCAP attestation quote with the given user data embedded. */
  async getQuote(userData: Buffer): Promise<Buffer> {
    const response = await this.send({
      action: "get_quote",
      userData: userData.toString("base64"),
    });
    if (typeof response.quote !== "string") {
      throw new Error("Invalid response from SGX worker: missing quote");
    }
    return Buffer.from(response.quote, "base64");
  }

  /**
   * Forward an encrypted payload to the enclave for decryption + proving.
   * The server never sees the plaintext — the enclave decrypts, proves,
   * and returns only the proof bytes.
   */
  async prove(encryptedData: Buffer): Promise<Buffer> {
    const response = await this.send({
      action: "prove",
      encryptedPayload: encryptedData.toString("base64"),
    });
    if (typeof response.proof !== "string") {
      throw new Error(
        `SGX worker prove failed: ${typeof response.error === "string" ? response.error : "missing proof in response"}`,
      );
    }
    return Buffer.from(response.proof, "base64");
  }

  /**
   * Send a JSON request to the worker and read the JSON response.
   * Opens a new TCP connection per request (short-lived).
   *
   * Does NOT call socket.end() before reading the response — length-prefix
   * framing tells each side when the message is complete, avoiding TCP
   * half-close issues (Bun closes the socket fully on end()).
   */
  async send(request: object): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let responseLength: number | null = null;

      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        const payload = Buffer.from(JSON.stringify(request));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(payload.length, 0);
        socket.write(Buffer.concat([header, payload]));
      });

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Read the response length from the first 4 bytes
        if (responseLength === null && buffer.length >= 4) {
          responseLength = buffer.readUInt32BE(0);
        }

        // Once we have the full response, parse and resolve
        if (responseLength !== null && buffer.length >= 4 + responseLength) {
          const body = buffer.subarray(4, 4 + responseLength);
          socket.destroy();
          try {
            const response = JSON.parse(body.toString()) as Record<string, unknown>;
            if (typeof response.error === "string") {
              reject(new Error(`SGX worker error: ${response.error}`));
              return;
            }
            resolve(response);
          } catch (err) {
            reject(
              new Error(
                `Failed to parse SGX worker response: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          }
        }
      });

      socket.on("end", () => {
        // If we haven't resolved yet, the server closed before sending a full response
        if (responseLength === null) {
          reject(new Error("SGX worker closed connection without sending a response"));
        }
      });

      socket.on("error", (err) => {
        logger.error("SGX worker connection error", { error: err.message });
        reject(new Error(`SGX worker connection failed: ${err.message}`));
      });
    });
  }
}
