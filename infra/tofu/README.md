# OpenTofu Infrastructure

OpenTofu configuration for tee-rex AWS infrastructure. All 3 environments (ci, prod, devnet) in a single state file.

## Prerequisites

- [OpenTofu](https://opentofu.org/) >= 1.9.0 (`brew install opentofu`)
- AWS CLI configured with admin access
- S3 state bucket and DynamoDB lock table (see Bootstrap below)

## Quick Start

```bash
cd infra/tofu

# 1. Copy and fill in real values (terraform.tfvars is gitignored)
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with real AWS resource values

# 2. Initialize
tofu init

# 3. Review changes (read-only, changes nothing)
tofu plan

# 4. Apply (only after reviewing plan)
tofu apply

# 5. Check state
tofu state list
tofu output
```

## Bootstrap (One-Time Setup)

Create the S3 state bucket before `tofu init`. Locking uses S3 native lockfile (`use_lockfile = true`) — no DynamoDB needed.

```bash
aws s3api create-bucket --bucket tee-rex-tofu-state --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2
aws s3api put-bucket-versioning --bucket tee-rex-tofu-state \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket tee-rex-tofu-state \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Safety Snapshot

Before importing resources, capture a full snapshot of current AWS state:

```bash
./snapshot.sh
```

This saves all resource IDs and configurations to `.snapshot/` (gitignored). Use as a recovery reference if anything goes wrong.

## Import Commands

All imports use `tofu import` CLI commands. Resource IDs are typed in the terminal and never appear in committed files. Run these in order after `tofu init`.

**Tip**: Load IDs from terraform.tfvars or environment variables to avoid typos:

```bash
# Example: source IDs from a local (gitignored) script
source .snapshot/import-vars.sh  # create this yourself from snapshot data
```

### Phase 2: Security Group

```bash
tofu import aws_security_group.tee_rex <SG_ID>
tofu import aws_vpc_security_group_ingress_rule.ssh <SSH_RULE_ID>
tofu import aws_vpc_security_group_ingress_rule.cloudfront <CF_RULE_ID>
tofu import aws_vpc_security_group_egress_rule.all <EGRESS_RULE_ID>
```

Get rule IDs: `aws ec2 describe-security-group-rules --filters "Name=group-id,Values=<SG_ID>" --region eu-west-2`

### Phase 3: IAM

```bash
tofu import aws_iam_openid_connect_provider.github arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
tofu import aws_iam_role.ci tee-rex-ci-github
tofu import aws_iam_policy.ci arn:aws:iam::<ACCOUNT_ID>:policy/tee-rex-ci-policy
tofu import aws_iam_role_policy_attachment.ci tee-rex-ci-github/arn:aws:iam::<ACCOUNT_ID>:policy/tee-rex-ci-policy
tofu import aws_iam_role_policy.ci_inline tee-rex-ci-github:tee-rex-ci-policy
tofu import aws_iam_role.ec2 tee-rex-ec2-role
tofu import aws_iam_role_policy_attachment.ec2_ssm tee-rex-ec2-role/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
tofu import aws_iam_role_policy_attachment.ec2_ecr tee-rex-ec2-role/arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
tofu import aws_iam_instance_profile.ec2 tee-rex-ec2-profile
```

### Phase 4: ECR

```bash
tofu import aws_ecr_repository.tee_rex tee-rex
```

### Phase 5: EC2 + Key Pair

```bash
tofu import aws_key_pair.tee_rex tee-rex-key
tofu import aws_instance.ci_tee <CI_TEE_INSTANCE_ID>
tofu import aws_instance.ci_prover <CI_PROVER_INSTANCE_ID>
tofu import aws_instance.prod_tee <PROD_TEE_INSTANCE_ID>
tofu import aws_instance.prod_prover <PROD_PROVER_INSTANCE_ID>
tofu import aws_instance.devnet_tee <DEVNET_TEE_INSTANCE_ID>
tofu import aws_instance.devnet_prover <DEVNET_PROVER_INSTANCE_ID>
```

### Phase 6: Elastic IPs

```bash
tofu import aws_eip.prod_tee <PROD_TEE_EIP_ALLOC_ID>
tofu import aws_eip_association.prod_tee <PROD_TEE_EIP_ASSOC_ID>
tofu import aws_eip.prod_prover <PROD_PROVER_EIP_ALLOC_ID>
tofu import aws_eip_association.prod_prover <PROD_PROVER_EIP_ASSOC_ID>
tofu import aws_eip.devnet_tee <DEVNET_TEE_EIP_ALLOC_ID>
tofu import aws_eip_association.devnet_tee <DEVNET_TEE_EIP_ASSOC_ID>
tofu import aws_eip.devnet_prover <DEVNET_PROVER_EIP_ALLOC_ID>
tofu import aws_eip_association.devnet_prover <DEVNET_PROVER_EIP_ASSOC_ID>
```

### Phase 7: S3

```bash
tofu import aws_s3_bucket.prod tee-rex-app-prod
tofu import aws_s3_bucket_public_access_block.prod tee-rex-app-prod
tofu import aws_s3_bucket_policy.prod tee-rex-app-prod
tofu import aws_s3_bucket.devnet tee-rex-app-devnet
tofu import aws_s3_bucket_public_access_block.devnet tee-rex-app-devnet
tofu import aws_s3_bucket_policy.devnet tee-rex-app-devnet
```

### Phase 8: ACM

```bash
tofu import aws_acm_certificate.wildcard <ACM_CERT_ARN>
```

### Phase 9: CloudFront

```bash
tofu import aws_cloudfront_origin_access_control.app <OAC_ID>
tofu import aws_cloudfront_response_headers_policy.coop_coep <RESPONSE_HEADERS_POLICY_ID>
tofu import aws_cloudfront_function.strip_prefix tee-rex-strip-prefix
tofu import aws_cloudfront_distribution.prod <PROD_DISTRIBUTION_ID>
tofu import aws_cloudfront_distribution.devnet <DEVNET_DISTRIBUTION_ID>
```

## After Import: Verify

```bash
# Should show "No changes"
tofu plan

# Should list ~30+ resources
tofu state list

# Verify outputs
tofu output
```

## Safety Guardrails

| Resource | Protection |
|----------|-----------|
| EC2 instances | `lifecycle { ignore_changes = [ami, user_data, user_data_base64] }` |
| S3 buckets | `lifecycle { prevent_destroy = true }` |
| CloudFront distributions | `lifecycle { prevent_destroy = true }` |
| ACM certificate | `lifecycle { prevent_destroy = true, ignore_changes = all }` |
| Key pair | `lifecycle { prevent_destroy = true }` |
| State file | S3 versioning + DynamoDB locking |

## Security Notes

This is a **public repository**. Secrets are separated from code:

- **`terraform.tfvars`** holds all real values — **gitignored**, never committed
- **`terraform.tfvars.example`** has placeholder values — committed, safe
- All `.tf` files use `var.*` or `data.*` references — no hardcoded IDs
- Imports via `tofu import` CLI — resource IDs stay in your terminal
- Sensitive outputs marked with `sensitive = true`
- State file lives in S3 (not in repo)

## What OpenTofu Does NOT Manage

- GitHub Actions workflows (deploy via SSM to same instance IDs)
- GitHub Secrets (instance IDs, ECR URLs remain the same)
- Application deployment (Docker build/push, EIF build, SSM commands)
- Default VPC and subnets (referenced but not managed)
- Cloudflare DNS (not managed)
- S3 state bucket and DynamoDB lock table (bootstrap resources)

## Emergency: Remove Resource from Tracking

If OpenTofu wants to modify a resource you don't want changed:

```bash
# Remove from state (does NOT touch the real AWS resource)
tofu state rm <resource_address>
```

Or to abandon all tracking: delete the S3 state bucket. Your infrastructure continues running as-is.
