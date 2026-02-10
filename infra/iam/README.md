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

## 5. GitHub Repository Secrets

Add these in Settings > Secrets and variables > Actions > Secrets:

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/tee-rex-ci-github` |
| `TEE_INSTANCE_ID` | Instance ID from step 4 |
| `AWS_REGION` | `eu-west-2` |
| `ECR_REGISTRY` | `<ACCOUNT_ID>.dkr.ecr.eu-west-2.amazonaws.com` |

No long-lived AWS keys needed — OIDC provides credentials dynamically.
These values are stored as secrets to avoid exposing infrastructure details in logs.

## Security Notes

- **No long-lived AWS keys** stored anywhere. OIDC tokens are short-lived (1 hour).
- **Trust policy** restricts role assumption to `main` and `chore/aztec-spartan-*` branches only.
- **EC2 permissions** scoped to instances tagged `Environment: ci` — cannot touch other instances.
- **ECR permissions** scoped to the `tee-rex` repository only.
