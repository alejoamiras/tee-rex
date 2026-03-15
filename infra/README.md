# TEE-Rex — AWS Nitro Enclave Deployment

## Architecture

```
Client (SDK)
    │
    ▼ HTTPS (via CloudFront)
EC2 Host — Host Container (Express, port 80, --network host)
    │ TEE_MODE=nitro — proxies to enclave
    │ Downloads bb from GitHub releases, uploads to enclave
    ▼ http://localhost:4000 (via socat: TCP :4000 → vsock CID:5000)
Nitro Enclave — Enclave Service (Bun.serve, port 4000)
    ├── POST /upload-bb     → save binary, compute SHA256
    ├── POST /prove         → decrypt → prove → return proof
    ├── GET /attestation    → NSM doc + encryption key + bb hashes in user_data
    ├── GET /public-key     → encryption public key
    └── GET /health         → loaded versions + hashes
```

bb binaries are not baked into Docker images — they're downloaded by the host
at deploy time and uploaded to the enclave via `POST /upload-bb`.

## Prerequisites

- An EC2 instance with Nitro Enclave support (e.g., `c5.xlarge`, `m5.xlarge`)
- [Nitro Enclaves CLI](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli-install.html) installed
- Docker installed on the EC2 instance
- Enclave allocator configured (`/etc/nitro_enclaves/allocator.yaml`):
  ```yaml
  # Production (c7i.12xlarge): 46 vCPUs, 81920 MB with hugepages
  # Dev/test: adjust to instance size
  cpu_count: 46
  memory_mib: 81920
  ```

## Deployment

### 1. Build the Docker image

```bash
# On the EC2 instance (or build + push to ECR)
docker build -f Dockerfile.nitro -t tee-rex-nitro .
```

### 2. Build the enclave image (EIF)

```bash
./infra/enclave.sh build
```

This outputs PCR values (SHA-384 hashes). Save these — clients use them to verify attestation:

```
PCR0: <hash>   # Enclave image measurement
PCR1: <hash>   # Linux kernel + boot ramfs
PCR2: <hash>   # Application
```

### 3. Run the enclave

```bash
# Start the enclave
./infra/enclave.sh run

# Start the TCP → vsock proxy
./infra/proxy.sh
```

### 4. Verify

```bash
# Test attestation endpoint
curl http://localhost:4000/attestation | jq .mode
# Should output: "nitro"
```

## SDK Configuration

```ts
import { TeeRexProver } from "@alejoamiras/tee-rex";

const prover = new TeeRexProver("https://your-ec2-ip:4000", simulator);

// Require attestation — reject non-TEE servers
prover.setAttestationConfig({
  requireAttestation: true,
  // Pin to specific enclave build (from step 2)
  expectedPCRs: {
    0: "abc123...",  // PCR0 from `enclave.sh build`
  },
});
```

## Useful Commands

```bash
# View enclave console output
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# List running enclaves
./infra/enclave.sh describe

# Stop the enclave
./infra/enclave.sh stop
```

## Troubleshooting

**"Failed to initialize NSM library"**: The server is not running inside a Nitro Enclave. Check `TEE_MODE` is set to `nitro` and the enclave is running.

**Proxy not connecting**: Verify the enclave CID matches. Run `nitro-cli describe-enclaves` to find the CID.

**Out of memory**: Increase `MEMORY_MB` in `enclave.sh` and the allocator config. Barretenberg proving is memory-intensive.
