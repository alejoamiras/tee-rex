# Phase 5D: Nitro Enclave Deployment — Lessons Learned

## STATUS: WORKING (2026-02-07)

The loopback fix (`ifconfig lo 127.0.0.1` instead of `ip link set dev lo up`) resolved the core blocker. The enclave successfully returns real Nitro attestation documents via the `/attestation` endpoint.

## Context

Deploying tee-rex server inside an AWS Nitro Enclave on EC2 (m5.xlarge).
Architecture: Local build → ECR push → EC2 pulls → nitro-cli build-enclave → run-enclave → socat vsock proxy.

---

## AWS Infrastructure (What Worked)

- **Region**: eu-west-2 (London), Account: <ACCOUNT_ID>
- **ECR**: `<ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com/tee-rex`
- **Security group**: `<SECURITY_GROUP_ID>` (ports 22, 4000)
- **IAM role**: `tee-rex-ec2-role` with `AmazonSSMManagedInstanceCore` + `AmazonEC2ContainerRegistryReadOnly`
- **Instance profile**: `tee-rex-ec2-profile`
- **AMI**: `<AMI_ID>` (AL2023 x86_64)
- **Key pair**: `tee-rex-key`
- **Instance type**: m5.xlarge (4 vCPUs, 16 GiB) — ~$0.21/hr eu-west-2
- SSM works for remote commands (no SSH needed): `aws ssm send-command`

**NOTE**: All these resources were deleted. They need to be recreated for the next attempt.

---

## Docker Build Lessons

### 1. libnsm.so must be compiled from source
- **FAILED**: `dnf install -y aws-nitro-enclaves-sdk-c` — package does NOT exist in any Amazon Linux repo
- **WORKED**: Compile from Rust source using `aws/aws-nitro-enclaves-nsm-api` GitHub repo
- Use `rust:1.85-slim` (NOT 1.83 — v0.4.0 needs edition2024, stabilized in Rust 1.85)
- Build command: `cargo build --release -p nsm-lib`
- Output: `target/release/libnsm.so`

### 2. All workspace package.json files must be copied
- **FAILED**: Only copying sdk + server package.json → `bun install` fails because root package.json lists all workspaces
- **WORKED**: Copy ALL workspace package.json files (sdk, server, integration, demo)

### 3. Docker image works on host
- Running `docker run -p 4001:4000 -e TEE_MODE=standard tee-rex-nitro:latest` on EC2 host works perfectly
- `/attestation` returns valid JSON with `mode: "standard"`, publicKey
- The socat inside complains about `/dev/vsock` not existing (expected outside enclave)

---

## Nitro Enclave Lessons

### 4. NITRO_CLI_ARTIFACTS env var required
- **FAILED**: `nitro-cli build-enclave` without it → error E51
- **WORKED**: `NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts nitro-cli build-enclave ...`

### 5. Memory requirements
- **FAILED**: `--memory 4096` → error E26 "minimum memory should be 4304 MB"
- **WORKED**: `--memory 6144` (with allocator set to 8192 MiB in `/etc/nitro_enclaves/allocator.yaml`)
- Our EIF is ~1.1GB, so it needs more than 4GB overhead

### 6. Allocator config
- Config file: `/etc/nitro_enclaves/allocator.yaml`
- Must set `memory_mib: 8192` and `cpu_count: 2`
- Restart after changes: `systemctl restart nitro-enclaves-allocator`

### 7. Enclave CID changes every restart
- Each `nitro-cli run-enclave` assigns a new CID (16, 17, 18, ...)
- The host-side socat proxy must be restarted with the new CID
- Pattern: `socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:<CID>:5000`

### 8. Debug mode required for console
- `--debug-mode` flag needed to read console via `nitro-cli console`
- Without it, console connection fails

### 9. WORKDIR not preserved by enclave init
- **FAILED**: Entrypoint assumes PWD is `/app/packages/server` (from Dockerfile WORKDIR)
- **WORKED**: Explicit `cd /app/packages/server` in entrypoint.sh
- Enclave init starts the CMD from `/` regardless of WORKDIR

---

## The Unsolved Loopback Problem (Core Blocker)

### What we know:
1. Inside the Nitro Enclave, the **loopback interface (`lo`) is NOT up by default**
2. The server binds to port 4000 successfully (we see "Server started" in console)
3. But `curl http://localhost:4000/...` fails because loopback is down
4. The socat bridge (vsock:5000 → TCP:localhost:4000) also fails for the same reason
5. From the host, vsock connections timeout because nothing responds

### What we tried and their results:

| Attempt | Entrypoint approach | Result |
|---------|-------------------|--------|
| v3 | `exec > /dev/console 2>&1`, no loopback fix, health check to `/attestation` | Enclave ALIVE, server starts, but health check fails 30 times, socat bridge starts but host can't reach it |
| v4 | Same as v3 + `ip link set dev lo up \|\| ifconfig lo up \|\| true` | Enclave ALIVE, same health check failure, server started but still unreachable |
| v5 | `exec > >(tee /dev/console) 2>&1` + loopback fix | Console E11, HTTP 000, possibly alive but unreachable |
| v6 | `exec > /dev/console 2>&1` + loopback + `exec bun run` at end | Enclave CRASHED — `exec` replaces shell, children die |
| v7 | `#!/bin/sh`, no console redirect, `exec bun run` | Enclave CRASHED |
| v8 | `#!/bin/bash`, `set -x`, `ifconfig \|\| ip` | Enclave CRASHED |
| v9 | Back to v3 style + loopback + verbose health check | Enclave CRASHED |
| v10 | v3 style + `ip link set dev lo up 2>/dev/null \|\| true` | Enclave CRASHED |

### Key observations:
- v3 and v4 stayed alive, v6-v10 crashed
- The difference between v4 (alive) and v6+ (crash) is unclear — could be Docker layer caching, entrypoint syntax, or something subtle
- `exec > /dev/console 2>&1` worked in v3/v4 but blocks `nitro-cli console` from outside (E11)
- The `exec bun run` approach (replacing shell with bun) is definitely wrong — kills socat child

### Theories on why v6-v10 crash:
1. **Docker heredoc encoding** — the COPY heredoc might produce different line endings or encoding across edits
2. **Entrypoint doesn't start** — the init might not find `/bin/bash` or the script might have issues
3. **`ip link set dev lo up` causes a fatal error** — in some enclave configurations, network operations might be restricted
4. **Process management** — if bun crashes (e.g., FFI segfault) and entrypoint exits, enclave terminates

### Root cause found (via research, 2026-02-07):

**`ip link set dev lo up` only brings the interface UP — it does NOT assign the 127.0.0.1 IP address.** That's why v3/v4 had the server "start" (bind succeeds on 0.0.0.0:4000) but `curl localhost:4000` failed — there was no 127.0.0.1 address to resolve to.

The correct command is:
```bash
ifconfig lo 127.0.0.1    # Brings up interface AND assigns IP atomically
```
Or the two-step `ip` approach:
```bash
ip link set lo up
ip addr add 127.0.0.1/8 dev lo
```

This is confirmed by multiple production Nitro Enclave projects:
- richardfan1126's Python Nitro Enclave demo uses `ifconfig lo 127.0.0.1`
- distributed-lab/enclave-extras uses `ip link set lo up` + `ip addr add`
- Marlin uses `ifconfig lo 127.0.0.1` + `ip route add default dev lo src 127.0.0.1`
- EdgeBit's Enclaver has a Rust supervisor that brings up loopback before user app
- Evervault uses a Rust data plane that configures loopback + iptables

### Other key findings from research:
- AWS init (aws-nitro-enclaves-sdk-bootstrap/init.c) does ZERO networking setup — only mounts filesystems, loads NSM kernel module, sends heartbeat, execs CMD
- AWS official samples (vsock_sample) don't use loopback at all — they listen directly on vsock sockets
- `net-tools` package (provides `ifconfig`) must be installed in the Docker image

### Approaches for next attempt (ordered by preference):

1. **Fix loopback command** (simplest): Replace `ip link set dev lo up` with `ifconfig lo 127.0.0.1`. Install `net-tools` in Docker image. Keep socat vsock→TCP bridge as-is.
2. **Unix domain socket** (no loopback needed): Express listens on `/tmp/tee-rex.sock`, socat bridges `VSOCK-LISTEN:5000 → UNIX-CONNECT:/tmp/tee-rex.sock`. Completely bypasses loopback.
3. **Both approaches in entrypoint**: Try loopback first, fall back to Unix socket if it fails.

---

## Deploy Script State

The user-data bootstrap script installed on EC2:
- docker, aws-nitro-enclaves-cli, aws-nitro-enclaves-cli-devel, socat, jq
- Configured allocator (8192 MiB, 2 CPUs)
- Pulled Docker image from ECR
- All services enabled (docker, nitro-enclaves-allocator)

---

## Cost Note

m5.xlarge costs ~$0.21/hr in eu-west-2. Don't leave running overnight.
Consider using spot instances for testing (~60-70% cheaper).
