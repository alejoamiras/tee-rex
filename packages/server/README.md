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
- **Response:** `{ "proof": "<base64-proof>" }`
- **Headers:** `X-Request-Id` (optional, generated if missing; echoed in response)

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
