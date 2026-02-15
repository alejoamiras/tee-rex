# ============================================================================
# terraform.tfvars — actual values for your variables.
#
# This is like your .env file. In practice, you'd either:
# 1. Gitignore this file and pass values via CI environment variables
# 2. Keep it in the repo with placeholders (like current infra/ JSON files)
#
# OpenTofu automatically loads this file when you run `tofu plan` or `tofu apply`.
# ============================================================================

aws_account_id = "<ACCOUNT_ID>" # Replace with your real AWS account ID

environment = "prod"

image_tag = "prod"

# Region configurations
# To add a 3rd region, just add another entry here. No code changes needed.
regions = {
  london = {
    region          = "eu-west-2"
    tee_ami         = "ami-0abcdef1234567890" # Amazon Linux 2 in eu-west-2
    prover_ami      = "ami-0abcdef1234567890"
    tee_instance    = "m5.xlarge"             # 4 vCPU, 16 GB — Nitro Enclave capable
    prover_instance = "t3.xlarge"             # 4 vCPU, 16 GB — burstable, good for proving
    deploy_tee      = true
    deploy_prover   = true
  }

  sao_paulo = {
    region          = "sa-east-1"
    tee_ami         = "ami-0fedcba9876543210" # Amazon Linux 2 in sa-east-1 (different AMI!)
    prover_ami      = "ami-0fedcba9876543210"
    tee_instance    = "m5.xlarge"
    prover_instance = "t3.xlarge"
    deploy_tee      = false                   # MVP: prover only. Flip to true when ready.
    deploy_prover   = true
  }

  # Uncomment to add a 3rd region:
  # mumbai = {
  #   region          = "ap-south-1"
  #   tee_ami         = "ami-0xxxxxxxxxxxxxxxxx"
  #   prover_ami      = "ami-0xxxxxxxxxxxxxxxxx"
  #   tee_instance    = "m5.xlarge"
  #   prover_instance = "t3.xlarge"
  #   deploy_tee      = false
  #   deploy_prover   = true
  # }
}
