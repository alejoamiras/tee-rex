# SSM Remote Deployment — Lessons Learned

## STATUS: IN PROGRESS (2026-02-08)

## Context

Deploying updated tee-rex Docker image (curve25519 + AEAD encryption changes) to EC2 via AWS SSM.

---

## Lesson 1: SSM commands run as root, nitro-cli needs ec2-user

- **FAILED**: `nitro-cli build-enclave` as root → error E51 "Artifacts path environment variable not set"
- **WORKED**: `sudo -u ec2-user nitro-cli build-enclave ...`
- The `NITRO_CLI_ARTIFACTS` env var is set in ec2-user's profile, not root's

## Lesson 2: SSM waits for ALL child processes to exit

- **FAILED**: `nohup socat ... &` in an SSM command → SSM command hangs forever (status: InProgress)
- SSM's RunShellScript document waits for the shell AND all child processes to finish
- Background processes via `&` or `nohup` keep the SSM command running indefinitely
- **WORKAROUND**: Use `disown` after backgrounding, OR run background services via systemd/screen, OR use separate SSM commands for start vs verify

## Lesson 3: Old EIF file permissions block overwrite

- **FAILED**: `rm -f /tmp/tee-rex.eif` as ec2-user when file was created by root → "Operation not permitted"
- **WORKED**: Remove as root first, then build as ec2-user
- Or: use a different output path, or `chmod` the file

## Lesson 4: Deployment flow via SSM

The correct sequence for SSM-based deployment:
1. Pull new Docker image (as root — docker needs root or docker group)
2. `nitro-cli terminate-enclave --all` (as ec2-user)
3. `pkill socat` to stop the proxy
4. Remove old EIF (as root if root created it)
5. `nitro-cli build-enclave` (as ec2-user)
6. `nitro-cli run-enclave` (as ec2-user) — this returns immediately
7. Start socat proxy — must be detached from SSM (use systemd or `setsid`)
8. Verify with a separate SSM command: `curl localhost:4000/attestation`

## Lesson 5: Starting persistent background services via SSM

For services that must outlive the SSM command (like socat proxy):
```bash
# Option A: setsid + redirect
setsid socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:16:5000 > /dev/null 2>&1 &
disown

# Option B: systemd service (more robust)
systemctl start tee-rex-proxy

# Option C: screen/tmux
screen -dmS proxy socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:16:5000
```

## Lesson 6: Enclave CID increments on each restart

- Each `nitro-cli run-enclave` assigns a new CID (16, 17, 18, ...)
- The socat proxy MUST use the new CID: `VSOCK-CONNECT:<NEW_CID>:5000`
- Get current CID: `nitro-cli describe-enclaves | jq -r '.[0].EnclaveCID'`
- If proxy points to old CID, connections silently timeout

## Lesson 7: Dockerfile.nitro must track workspace changes

- The `COPY packages/integration/package.json` line broke after integration package was deleted
- Any workspace restructuring must update ALL Dockerfiles that copy package.json files
