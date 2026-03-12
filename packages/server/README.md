# TEE-Rex Server

Express server that generates Aztec transaction proofs. Runs standalone for development or inside an AWS Nitro Enclave for production TEE attestation.

## Quick Start

```sh
bun install
bun run start    # starts on port 4000
bun run dev      # starts with --watch for development
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server listening port |
| `TEE_MODE` | `standard` | `"standard"` (dev) or `"nitro"` (Nitro Enclave) |
| `CRS_PATH` | — | Path to Barretenberg CRS files (Nitro only, pre-cached in the enclave image) |
| `HARDWARE_CONCURRENCY` | — | Controls Barretenberg thread count (set automatically via `$(nproc)` in Docker) |
| `BB_VERSIONS_DIR` | `~/.tee-rex/versions` | Directory for multi-version bb binary cache |
| `BB_BINARY_PATH` | — | Override path to the `bb` binary (bypasses version cache and node_modules) |

## API

### `GET /attestation`

Returns the server's public key and attestation document. Used by the SDK to establish encrypted communication.

**Standard mode:**

```json
{
  "mode": "standard",
  "publicKey": "<armored-pgp-key>"
}
```

**Nitro mode:**

```json
{
  "mode": "nitro",
  "attestationDocument": "<base64-cbor>",
  "publicKey": "<armored-pgp-key>"
}
```

### `POST /prove`

Accepts an encrypted proving request and returns the generated proof.

- **Rate limit:** 10 requests per hour per IP (localhost exempt)
- **Payload limit:** 50 MB
- **Request:** `{ "data": "<base64-encrypted-payload>" }`
- **Request headers:** `X-Request-Id` (optional, generated if missing; echoed in response), `X-Aztec-Version` (routes to correct bb binary version)
- **Response:** `{ "proof": "<base64-proof>" }`
- **Response headers:** `x-prove-duration-ms` (bb proving time), `x-decrypt-duration-ms` (payload decryption time)

### `GET /health`

Returns server status, API version, available bb binary versions, and runtime diagnostics.

```json
{
  "status": "ok",
  "api_version": 1,
  "available_versions": ["5.0.0-nightly.20260309"],
  "runtime": {
    "hardware_concurrency": "46",
    "available_parallelism": 46,
    "cpu_count": 46,
    "tee_mode": "nitro",
    "node_env": "production",
    "crs_path": "/crs"
  }
}
```

### `GET /encryption-public-key`

Legacy alias for the public key. Returns `{ "publicKey": "<armored-pgp-key>" }`.

## Docker

### Standalone (development/CI)

```sh
docker build -t tee-rex-server .
docker run -p 4000:80 tee-rex-server
```

The production Dockerfile exposes port 80 with a healthcheck on `/attestation`.

### Nitro Enclave (production)

```sh
# Build the Nitro-enabled Docker image
docker build -f Dockerfile.nitro -t tee-rex-nitro .

# Convert to an Enclave Image File (EIF)
nitro-cli build-enclave --docker-uri tee-rex-nitro --output-file tee-rex.eif

# Run the enclave
nitro-cli run-enclave --eif-path tee-rex.eif --cpu-count 2 --memory 4096
```

The Nitro image includes pre-cached CRS files (~530 MB) so the enclave can generate proofs without internet access. See [`infra/enclave.sh`](../../infra/enclave.sh) for the full enclave lifecycle commands.

## Architecture

For system diagrams, proving flow, and deployment details, see [docs/architecture.md](../../docs/architecture.md).
