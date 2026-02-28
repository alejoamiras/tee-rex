# AWS IAM Setup for CI

One-time manual setup for GitHub Actions OIDC authentication.

## Prerequisites

- AWS CLI configured with admin access
- GitHub repository: `alejoamiras/tee-rex`

## 1. Create OIDC Identity Provider

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> The thumbprint may change. Get the current one from:
> https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services

## 2. Create IAM Policy

```bash
aws iam create-policy \
  --policy-name tee-rex-ci-policy \
  --policy-document file://infra/iam/tee-rex-ci-policy.json
```

## 3. Create IAM Role

```bash
aws iam create-role \
  --role-name tee-rex-ci-github \
  --assume-role-policy-document file://infra/iam/tee-rex-ci-trust-policy.json

aws iam attach-role-policy \
  --role-name tee-rex-ci-github \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/tee-rex-ci-policy
```

## 4. Create EC2 Instance

See `docs/nitro-deployment.md` for full instructions. Key requirements:

- Instance type: `m5.xlarge` (enclave-enabled)
- IAM instance profile with `AmazonSSMManagedInstanceCore` + `AmazonEC2ContainerRegistryReadOnly`
- Tags: `Name: tee-rex-ci`, `Environment: ci`
- Enclave support: enabled
- Security group: inbound SSH 22 (CI uses SSM port forwarding — no public port 4000 needed)

After creation, **stop the instance**. CI will start/stop it as needed.

## 5. Create Production EC2 Instances

Production instances stay running after deployment (no teardown). They are started by `deploy-prod.yml` on push to main.

### Prod TEE Instance

```bash
# m5.xlarge — Nitro-capable, enclave-enabled
# Same user-data as CI TEE (see docs/nitro-deployment.md):
#   Docker + Nitro CLI + allocator config (8192 MiB, 2 CPUs)
# Tags: Name=tee-rex-prod-tee, Environment=prod, Service=tee
# Security group: sg-0a9f71899b494ed27 (SSH only)
# Reuses existing IAM instance profile, key pair, subnet
```

### Elastic IP

Allocate an Elastic IP and associate with the prod instance. Provides a stable address for CloudFront origins (Phase 17E).

```bash
aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=tee-rex-prod-tee},{Key=Environment,Value=prod}]'
aws ec2 associate-address --instance-id <PROD_TEE_INSTANCE_ID> --allocation-id <EIP_ALLOC_ID>
```

After creation, **stop the instance**. `deploy-prod.yml` will start it on deploy.

> **Note (Phase 29):** Both the Nitro enclave (port 4000) and the prover Docker container (port 80) run on the same m5.xlarge instance. No separate prover instance needed.

## 6. GitHub Repository Secrets

Add these in Settings > Secrets and variables > Actions > Secrets:

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/tee-rex-ci-github` |
| `TEE_INSTANCE_ID` | CI TEE instance ID (step 4) — runs both enclave + prover |
| `PROD_TEE_INSTANCE_ID` | Production TEE instance ID (step 5) — runs both enclave + prover |
| `AWS_REGION` | `eu-west-2` |
| `ECR_REGISTRY` | `<ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com` |
| `PROD_S3_BUCKET` | `tee-rex-app-prod` |
| `PROD_CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID (see `infra/cloudfront/README.md`) |
| `PROD_CLOUDFRONT_URL` | `https://d_____.cloudfront.net` |

No long-lived AWS keys needed — OIDC provides credentials dynamically.
These values are stored as secrets to avoid exposing infrastructure details in logs.

## Updating the CI Policy

> **Note**: The template file uses `<ACCOUNT_ID>` and `<DISTRIBUTION_ID>` as placeholders. Substitute real values before applying.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
DISTRIBUTION_ID="..."  # from GitHub secrets or: aws cloudfront list-distributions --query '...'
sed -e "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" -e "s/<DISTRIBUTION_ID>/$DISTRIBUTION_ID/g" \
  infra/iam/tee-rex-ci-policy.json > /tmp/ci-policy.json
aws iam put-role-policy \
  --role-name tee-rex-ci-github \
  --policy-name tee-rex-ci-policy \
  --policy-document file:///tmp/ci-policy.json
```

## Updating the Trust Policy

When the allowed branch patterns change (e.g., after renaming auto-update branches), update the trust policy.

> **Note**: The template file uses `<ACCOUNT_ID>` as a placeholder. Substitute your real account ID before applying.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" infra/iam/tee-rex-ci-trust-policy.json \
  > /tmp/trust-policy.json
aws iam update-assume-role-policy \
  --role-name tee-rex-ci-github \
  --policy-document file:///tmp/trust-policy.json
```

## Security Notes

- **No long-lived AWS keys** stored anywhere. OIDC tokens are short-lived (1 hour).
- **Trust policy** restricts role assumption to `main`, `chore/aztec-nightlies-*`, and `pull_request` only.
- **EC2 permissions** scoped to instances tagged `Environment: ci` or `Environment: prod` — cannot touch other instances.
- **ECR permissions** scoped to the `tee-rex` repository only.
