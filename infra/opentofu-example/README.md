# OpenTofu Example for tee-rex Multi-Region

**This is illustrative only** — not wired up to anything. It shows what the tee-rex
infrastructure *would* look like if managed with OpenTofu instead of shell scripts.

## What is OpenTofu?

OpenTofu is an open-source Infrastructure-as-Code tool. You describe your infrastructure
in `.tf` files using HCL (HashiCorp Configuration Language), and OpenTofu:

1. **Plans** — shows you what it *would* change (like a dry run)
2. **Applies** — creates/updates/deletes resources to match your description
3. **Tracks state** — remembers what's deployed, so it knows what to change next time

Think of it like a `package.json` for infrastructure — you declare what you want,
and the tool figures out how to get there.

## File Structure

```
infra/opentofu-example/
├── README.md           ← You are here
├── main.tf             ← Entry point: configures providers and calls the module per region
├── variables.tf        ← Input variables (account ID, instance IDs, etc.)
├── outputs.tf          ← What gets printed after `tofu apply` (IPs, URLs, etc.)
├── terraform.tfvars    ← Actual values for variables (like .env — gitignored in practice)
└── modules/
    └── tee-rex-region/ ← Reusable module: everything needed to run tee-rex in ONE region
        ├── main.tf     ← EC2 instances, security groups, Elastic IPs
        ├── variables.tf← Module inputs (region, instance type, etc.)
        └── outputs.tf  ← Module outputs (IPs, instance IDs)
```

## Key Concepts

### Providers
A "provider" is a plugin that talks to an API (AWS, GitHub, Cloudflare, etc.).
You configure one per region:

```hcl
provider "aws" {
  alias  = "london"
  region = "eu-west-2"
}
```

### Resources
A "resource" is a single piece of infrastructure. Each maps 1:1 to a real AWS resource:

```hcl
resource "aws_instance" "prover" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.xlarge"
}
```

### Modules
A "module" is a reusable group of resources. We define the tee-rex stack once,
then instantiate it per region:

```hcl
module "london" {
  source = "./modules/tee-rex-region"
  # ... london-specific values
}

module "sao_paulo" {
  source = "./modules/tee-rex-region"
  # ... sao-paulo-specific values
}
```

### State
OpenTofu stores a "state file" that maps your `.tf` declarations to real AWS resource IDs.
In production, you'd store this in S3 with DynamoDB locking:

```hcl
backend "s3" {
  bucket         = "tee-rex-tofu-state"
  key            = "prod/terraform.tfstate"
  region         = "eu-west-2"
  dynamodb_table = "tee-rex-tofu-lock"
}
```

## Workflow

```bash
# Initialize (downloads AWS provider plugin)
tofu init

# See what would change (dry run)
tofu plan

# Apply changes (creates/updates real AWS resources)
tofu apply

# Destroy everything (careful!)
tofu destroy
```

## How This Compares to Current Shell Scripts

| Current (scripts) | OpenTofu equivalent |
|---|---|
| `aws ec2 run-instances ...` in a shell script | `resource "aws_instance" "tee" { ... }` |
| JSON files with `<PLACEHOLDER>` | `variables.tf` + `terraform.tfvars` |
| Manual `sed` to substitute values | OpenTofu interpolation: `"${var.account_id}"` |
| No rollback if something fails | `tofu plan` shows changes before applying |
| No idea if someone changed something manually | `tofu plan` detects drift from expected state |
| Duplicate scripts per region | One module, instantiated N times |

## When to Actually Adopt This

Not yet. The current scripts work fine for 2 regions. Consider adopting OpenTofu when:
- Adding a 3rd region
- Needing staging/preview environments
- Wanting drift detection (did someone change a security group manually?)
- The team grows and needs a shared source of truth for infrastructure
