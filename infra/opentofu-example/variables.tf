# ============================================================================
# Variables — these are the INPUTS to your infrastructure.
# Think of them like function parameters. You declare them here,
# and provide values in terraform.tfvars (or via environment variables).
# ============================================================================

variable "aws_account_id" {
  description = "Your AWS account ID (12-digit number)"
  type        = string
  # No default — you MUST provide this. OpenTofu will ask for it if missing.
}

variable "ecr_repository" {
  description = "Name of the ECR repository for Docker images"
  type        = string
  default     = "tee-rex" # Sensible default — override if needed
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "prod"
}

# ============================================================================
# Regions — this is where multi-region gets interesting.
# Instead of duplicating everything, we define a MAP of regions,
# each with its own configuration. Then we loop over it.
# ============================================================================

variable "regions" {
  description = "Map of region configs. Each key becomes a deployment."
  type = map(object({
    region         = string # AWS region code
    tee_ami        = string # AMI ID for TEE instance (Amazon Linux 2, region-specific)
    prover_ami     = string # AMI ID for Prover instance (region-specific)
    tee_instance   = string # Instance type for TEE (must support Nitro Enclaves)
    prover_instance = string # Instance type for Prover
    deploy_tee     = bool   # Whether to deploy TEE in this region
    deploy_prover  = bool   # Whether to deploy Prover in this region
  }))

  # Example: start with prover-only in São Paulo (the MVP from Phase 21)
  default = {
    london = {
      region          = "eu-west-2"
      tee_ami         = "ami-0abcdef1234567890" # placeholder
      prover_ami      = "ami-0abcdef1234567890" # placeholder
      tee_instance    = "m5.xlarge"
      prover_instance = "t3.xlarge"
      deploy_tee      = true
      deploy_prover   = true
    }
    sao_paulo = {
      region          = "sa-east-1"
      tee_ami         = "ami-0fedcba9876543210" # placeholder — AMIs are region-specific!
      prover_ami      = "ami-0fedcba9876543210" # placeholder
      tee_instance    = "m5.xlarge"
      prover_instance = "t3.xlarge"
      deploy_tee      = false # MVP: prover only in São Paulo
      deploy_prover   = true
    }
  }
}

# ============================================================================
# SSH key — for SSM access (no SSH needed, but EC2 requires a key pair)
# ============================================================================

variable "key_pair_name" {
  description = "Name of the EC2 key pair (for SSM, not SSH)"
  type        = string
  default     = "tee-rex-ec2"
}

# ============================================================================
# Tags — applied to all resources for cost tracking and identification
# ============================================================================

variable "environment" {
  description = "Environment name (prod, ci, staging)"
  type        = string
  default     = "prod"
}
