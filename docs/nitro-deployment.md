# Nitro Enclave Deployment Runbook

Step-by-step guide to deploy, debug, iterate, and tear down TEE-Rex on an AWS Nitro Enclave.

## Prerequisites

- **AWS CLI** configured with credentials (`aws configure` or env vars)
- **Docker** with buildx (Docker Desktop includes this)
- **SSH client** (for connecting to the EC2 host)
- **Region**: eu-west-2 (London)
- **Account**: 741319250303

## Current Infrastructure

These resources already exist and can be reused:

| Resource | ID / Name |
|----------|-----------|
| ECR repo | `741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex` |
| Security group | `sg-0a9f71899b494ed27` (ports 22, 4000 open) |
| IAM role | `tee-rex-ec2-role` |
| Instance profile | `tee-rex-ec2-profile` |
| Key pair | `tee-rex-key` (private key in team secrets) |
| AMI | `ami-0737d2d50c7fece1b` (Amazon Linux 2023, x86_64) |

If any of these were deleted, see [Recreating Infrastructure](#recreating-infrastructure) at the bottom.

---

## 1. Build and Push the Docker Image

From the repo root on your local machine:

```bash
# Log into ECR
aws ecr get-login-password --region eu-west-2 \
  | docker login --username AWS --password-stdin \
    741319250303.dkr.ecr.eu-west-2.amazonaws.com

# Build for linux/amd64 and push to ECR in one step
docker buildx build \
  -f Dockerfile.nitro \
  --platform linux/amd64 \
  -t 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest \
  --push .
```

This takes ~2-5 minutes (longer on first build since the Rust stage compiles libnsm.so). Subsequent builds are faster due to Docker layer caching.

**What the build does** (3 stages):
1. **Rust stage**: Compiles `libnsm.so` from `aws-nitro-enclaves-nsm-api` — this is the library that talks to the NSM hardware
2. **Builder stage**: Installs npm dependencies with Bun, copies source code
3. **Runtime stage**: Assembles the final image with `libnsm.so`, the app, socat (vsock bridge), and the entrypoint script

---

## 2. Launch the EC2 Instance

First, create a file called `user-data.sh` with the EC2 bootstrap script:

```bash
#!/bin/bash
set -ex

# Install Docker + Nitro Enclaves CLI + utilities
dnf install -y docker aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel socat jq

# Configure Nitro Enclaves allocator: 8192 MiB, 2 CPUs
# (Our EIF is ~1.1GB, enclave needs --memory 6144, allocator must be >= that)
sed -i 's/^memory_mib:.*/memory_mib: 8192/' /etc/nitro_enclaves/allocator.yaml
sed -i 's/^cpu_count:.*/cpu_count: 2/' /etc/nitro_enclaves/allocator.yaml

# Enable and start services
systemctl enable --now docker
systemctl enable --now nitro-enclaves-allocator

# Add ec2-user to docker and ne groups
usermod -aG docker ec2-user
usermod -aG ne ec2-user

# Log into ECR and pull the image
aws ecr get-login-password --region eu-west-2 \
  | docker login --username AWS --password-stdin \
    741319250303.dkr.ecr.eu-west-2.amazonaws.com
docker pull 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest
docker tag 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest tee-rex-nitro:latest

# Signal bootstrap complete
touch /tmp/bootstrap-complete
```

Then launch:

```bash
aws ec2 run-instances \
  --image-id ami-0737d2d50c7fece1b \
  --instance-type m5.xlarge \
  --key-name tee-rex-key \
  --security-group-ids sg-0a9f71899b494ed27 \
  --iam-instance-profile Name=tee-rex-ec2-profile \
  --enclave-options Enabled=true \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tee-rex-nitro}]' \
  --region eu-west-2
```

**Instance type**: m5.xlarge (4 vCPUs, 16 GiB). We need at least this because:
- The enclave gets 2 vCPUs + 6 GiB memory
- The host needs the remaining 2 vCPUs + 10 GiB to run Docker, socat, etc.

Wait for it to come up and get the public IP:

```bash
# Get the instance ID from the output above, then:
INSTANCE_ID=i-0xxxxxxxxxxxxxxxxx

aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region eu-west-2

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --region eu-west-2 \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "Instance ready at: $PUBLIC_IP"
```

---

## 3. Wait for Bootstrap

The user-data script takes ~90 seconds to install packages and pull the Docker image. Check if it's done:

```bash
ssh -i tee-rex-key.pem ec2-user@$PUBLIC_IP \
  'test -f /tmp/bootstrap-complete && echo "READY" || echo "STILL BOOTSTRAPPING"'
```

If you get "STILL BOOTSTRAPPING", wait 30 seconds and try again. You can watch the progress with:

```bash
ssh -i tee-rex-key.pem ec2-user@$PUBLIC_IP \
  'sudo tail -f /var/log/cloud-init-output.log'
```

---

## 4. Build the Enclave Image (EIF)

SSH into the instance and build the EIF from the Docker image:

```bash
ssh -i tee-rex-key.pem ec2-user@$PUBLIC_IP
```

Then on the instance:

```bash
# Build the Enclave Image File (EIF) from the Docker image
NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts \
  nitro-cli build-enclave \
    --docker-uri tee-rex-nitro:latest \
    --output-file /tmp/tee-rex.eif
```

This outputs the PCR measurements (save these — clients use them to verify the enclave):

```
Enclave Image successfully created.
{
  "Measurements": {
    "HashAlgorithm": "Sha384 { ... }",
    "PCR0": "8ea65149c7369a...",   ← Hash of the enclave image
    "PCR1": "4b4d5b3661b3ef...",   ← Hash of the kernel + boot ramfs
    "PCR2": "24fc68a6f0a182..."    ← Hash of the application
  }
}
```

**PCR0** is the most important — it changes whenever the Docker image changes. Clients can pin to this value to ensure they're talking to exactly this code.

---

## 5. Run the Enclave

```bash
# Run the enclave in debug mode (allows console access)
nitro-cli run-enclave \
  --eif-path /tmp/tee-rex.eif \
  --cpu-count 2 \
  --memory 6144 \
  --enclave-name tee-rex \
  --debug-mode
```

Output shows the CID (you'll need this for the socat proxy):

```
Started enclave with enclave-cid: 16, memory: 6144 MiB, cpu-ids: [1, 3]
{
  "EnclaveName": "tee-rex",
  "EnclaveID": "i-xxx-enc...",
  "EnclaveCID": 16,          ← Note this number
  ...
}
```

**Important**: The `--debug-mode` flag is needed to read console output. Remove it in production for full security (attestation documents will have different PCR values in debug vs production mode).

---

## 6. Start the Host-Side Proxy

The enclave has no network — it only speaks vsock. We need socat on the host to bridge TCP port 4000 to the enclave's vsock port 5000:

```bash
# Replace 16 with the CID from step 5
CID=16
nohup socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:$CID:5000 \
  </dev/null >/tmp/socat.log 2>&1 &

# Verify it's listening
ss -tlnp | grep 4000
```

You should see socat listening on `0.0.0.0:4000`.

---

## 7. Test

From your local machine:

```bash
# Test the attestation endpoint
curl -s http://$PUBLIC_IP:4000/attestation | jq .mode
# Expected: "nitro"

# See the full attestation document
curl -s http://$PUBLIC_IP:4000/attestation | jq .
```

A successful response looks like:

```json
{
  "mode": "nitro",
  "attestationDocument": "hEShATgioFkUb7...",
  "publicKey": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n..."
}
```

You can also test the Docker image directly on the host (without the enclave) to isolate issues:

```bash
# On the EC2 instance — runs as a normal container, no enclave
docker run --rm -p 4001:4000 -e TEE_MODE=standard tee-rex-nitro:latest

# Then from local:
curl -s http://$PUBLIC_IP:4001/attestation | jq .mode
# Expected: "standard" (no NSM hardware outside the enclave)
```

---

## Debugging

### SSH into the host

```bash
ssh -i tee-rex-key.pem ec2-user@$PUBLIC_IP
```

### View enclave console output

This is the main debugging tool. It shows stdout/stderr from inside the enclave (only works in debug mode):

```bash
# Get the enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Stream console output (Ctrl+C to stop)
nitro-cli console --enclave-id $ENCLAVE_ID
```

You should see the boot sequence, then our entrypoint output:

```
=== TEE-Rex Enclave Starting ===
Waiting... attempt 1
Server started
Server ready (attempt 2)
Enclave ready: TEE_MODE=nitro, vsock:5000 -> tcp:4000
```

**Note**: Our entrypoint uses `exec > /dev/console 2>&1` to redirect output, which takes exclusive control of the console device. You'll see output from when the enclave started, but `nitro-cli console` may error with E11 if it can't attach. This is expected — the output is still there from the initial capture.

### Check enclave status

```bash
nitro-cli describe-enclaves
```

Shows whether the enclave is RUNNING or TERMINATED, plus CID, memory, CPU, and PCR measurements.

### Check socat proxy

```bash
# Is socat running?
ps aux | grep socat

# Is it listening?
ss -tlnp | grep 4000

# Check socat logs
cat /tmp/socat.log
```

### Check cloud-init logs (bootstrap issues)

```bash
sudo cat /var/log/cloud-init-output.log
```

### Common Errors

| Error | Meaning | Fix |
|-------|---------|-----|
| **E11** | Console read conflict — entrypoint took `/dev/console` | Expected with our entrypoint. Output is still captured. |
| **E26** | Not enough memory for enclave | Increase `--memory` (we use 6144). Make sure allocator has enough (`memory_mib: 8192`). |
| **E45** | Console read error on a running enclave | Usually transient. Try again, or check if enclave is still running. |
| **E51** | Missing `NITRO_CLI_ARTIFACTS` env var | Prefix command with `NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts`. |
| Enclave crashes immediately | Entrypoint script issue | Test the Docker image directly: `docker run --rm -it tee-rex-nitro:latest bash` |
| Health check fails 30 times | Loopback not configured | Make sure `ifconfig lo 127.0.0.1` is in the entrypoint (not just `ip link set lo up`). |
| vsock timeout from host | Enclave not listening on vsock, or wrong CID | Check CID with `nitro-cli describe-enclaves`, restart socat with correct CID. |

### Test the Docker image without the enclave

If you suspect the issue is in the app (not the enclave infrastructure), run the image directly on the host:

```bash
# Interactive mode — get a shell inside the container
docker run --rm -it -e TEE_MODE=standard tee-rex-nitro:latest bash

# Inside the container:
cd /app/packages/server
bun run src/index.ts
# Then curl http://localhost:4000/attestation from another terminal
```

---

## Iterating (Code Changes)

When you change code and want to redeploy:

### From your local machine:

```bash
# 1. Build and push the new image
docker buildx build \
  -f Dockerfile.nitro \
  --platform linux/amd64 \
  -t 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest \
  --push .
```

### On the EC2 instance:

```bash
# 2. Terminate the running enclave
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID

# 3. Kill the old socat proxy
pkill socat

# 4. Pull the new image
aws ecr get-login-password --region eu-west-2 \
  | docker login --username AWS --password-stdin \
    741319250303.dkr.ecr.eu-west-2.amazonaws.com
docker pull 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest
docker tag 741319250303.dkr.ecr.eu-west-2.amazonaws.com/tee-rex:latest tee-rex-nitro:latest

# 5. Rebuild the EIF
NITRO_CLI_ARTIFACTS=/tmp/nitro-artifacts \
  nitro-cli build-enclave \
    --docker-uri tee-rex-nitro:latest \
    --output-file /tmp/tee-rex.eif

# 6. Run the new enclave
nitro-cli run-enclave \
  --eif-path /tmp/tee-rex.eif \
  --cpu-count 2 \
  --memory 6144 \
  --enclave-name tee-rex \
  --debug-mode

# 7. Get the new CID and start socat
CID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveCID')
nohup socat TCP-LISTEN:4000,fork,reuseaddr VSOCK-CONNECT:$CID:5000 \
  </dev/null >/tmp/socat.log 2>&1 &

# 8. Test
curl -s http://localhost:4000/attestation | jq .mode
```

**Tip**: The CID increments each time you run a new enclave (16, 17, 18...). Always re-read it from `nitro-cli describe-enclaves`.

---

## Teardown

### Terminate the enclave (keep the EC2 instance)

```bash
# On the EC2 instance:
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID
pkill socat
```

### Terminate the EC2 instance

```bash
# From your local machine:
aws ec2 terminate-instances \
  --instance-ids $INSTANCE_ID \
  --region eu-west-2
```

This stops the billing. The ECR repo, security group, IAM role, and key pair persist and cost nothing (or nearly nothing for ECR storage).

### Delete everything (full cleanup)

```bash
# Delete ECR repo (and all images in it)
aws ecr delete-repository --repository-name tee-rex --force --region eu-west-2

# Delete security group
aws ec2 delete-security-group --group-id sg-0a9f71899b494ed27 --region eu-west-2

# Delete key pair
aws ec2 delete-key-pair --key-name tee-rex-key --region eu-west-2

# Detach policies and delete IAM role + instance profile
aws iam remove-role-from-instance-profile \
  --instance-profile-name tee-rex-ec2-profile \
  --role-name tee-rex-ec2-role
aws iam delete-instance-profile --instance-profile-name tee-rex-ec2-profile
aws iam detach-role-policy \
  --role-name tee-rex-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam detach-role-policy \
  --role-name tee-rex-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam delete-role --role-name tee-rex-ec2-role
```

---

## Recreating Infrastructure

If the resources were deleted, here's how to recreate them:

### ECR Repository

```bash
aws ecr create-repository --repository-name tee-rex --region eu-west-2
```

### Security Group

```bash
# Create the security group
SG_ID=$(aws ec2 create-security-group \
  --group-name tee-rex-sg \
  --description "TEE-Rex Nitro Enclave" \
  --region eu-west-2 \
  --query 'GroupId' --output text)

# Allow SSH
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp --port 22 \
  --cidr 0.0.0.0/0 \
  --region eu-west-2

# Allow HTTP on port 4000 (tee-rex server)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp --port 4000 \
  --cidr 0.0.0.0/0 \
  --region eu-west-2

echo "Security group: $SG_ID"
```

### Key Pair

```bash
aws ec2 create-key-pair \
  --key-name tee-rex-key \
  --query 'KeyMaterial' \
  --output text \
  --region eu-west-2 > tee-rex-key.pem

chmod 400 tee-rex-key.pem
```

**Save `tee-rex-key.pem` somewhere safe.** You need it to SSH into the instance.

### IAM Role + Instance Profile

```bash
# Create the role
aws iam create-role \
  --role-name tee-rex-ec2-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies (SSM for remote commands, ECR for pulling images)
aws iam attach-role-policy \
  --role-name tee-rex-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam attach-role-policy \
  --role-name tee-rex-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Create instance profile and attach the role
aws iam create-instance-profile --instance-profile-name tee-rex-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name tee-rex-ec2-profile \
  --role-name tee-rex-ec2-role

# Wait a few seconds for IAM propagation before launching an instance
sleep 10
```

### Resolve the Latest AMI

```bash
AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --region eu-west-2 \
  --query 'Parameters[0].Value' --output text)

echo "AMI: $AMI_ID"
```

---

## Cost

| Resource | Cost |
|----------|------|
| m5.xlarge (on-demand) | ~$0.21/hr (~$5/day) |
| m5.xlarge (spot) | ~$0.07/hr (~$1.70/day) — 60-70% cheaper |
| ECR storage | ~$0.10/GB/month (our image is ~1.1GB) |
| Data transfer | Negligible for testing |

**Don't leave the instance running overnight.** Terminate it when you're done testing. The ECR repo, security group, IAM role, and key pair cost essentially nothing to keep around.

To use spot instances (recommended for testing):

```bash
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type m5.xlarge \
  --key-name tee-rex-key \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=tee-rex-ec2-profile \
  --enclave-options Enabled=true \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tee-rex-nitro}]' \
  --instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time"}}' \
  --region eu-west-2
```

---

## Architecture Reference

```
┌─────────────────────────────────────┐
│  Your machine                       │
│  curl http://<public-ip>:4000/...   │
└──────────────┬──────────────────────┘
               │ TCP port 4000
               ▼
┌─────────────────────────────────────┐
│  EC2 Host (m5.xlarge)               │
│  Amazon Linux 2023                  │
│                                     │
│  socat TCP:4000 ↔ vsock:CID:5000   │
│  (bridges TCP to enclave vsock)     │
└──────────────┬──────────────────────┘
               │ vsock (hypervisor-controlled)
               ▼
┌─────────────────────────────────────┐
│  Nitro Enclave                      │
│  (no network, no disk, no SSH)      │
│                                     │
│  entrypoint.sh:                     │
│    ifconfig lo 127.0.0.1            │
│    bun run src/index.ts &           │
│    socat vsock:5000 ↔ tcp:4000      │
│                                     │
│  Express server on localhost:4000   │
│  TEE_MODE=nitro                     │
│  libnsm.so → /dev/nsm (hardware)   │
└─────────────────────────────────────┘
```
