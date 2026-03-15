# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "eu-west-2"
}

# -----------------------------------------------------------------------------
# EC2
# -----------------------------------------------------------------------------

variable "prod_instance_type" {
  description = "EC2 instance type for prod (c7i.12xlarge for performance, c7i.2xlarge for cost savings)"
  type        = string
  default     = "c7i.2xlarge"
}

variable "ec2_key_name" {
  description = "EC2 key pair name"
  type        = string
  default     = "tee-rex-key"
}

variable "ec2_public_key" {
  description = "Public key material for the tee-rex EC2 key pair"
  type        = string
  sensitive   = true
}

variable "default_subnet_id" {
  description = "Subnet ID for EC2 instances (default VPC)"
  type        = string
}

variable "instance_amis" {
  description = "AMI ID per EC2 instance (used at import time, ignored after via lifecycle)"
  type = object({
    ci_tee   = string
    prod_tee = string
  })
}

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------

variable "ssh_cidr_blocks" {
  description = "CIDR blocks allowed SSH access — disabled by default (CI uses SSM). Set to your IP for debugging."
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# IAM
# -----------------------------------------------------------------------------

variable "github_oidc_thumbprint" {
  description = "GitHub Actions OIDC provider thumbprint"
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}

# -----------------------------------------------------------------------------
# ECR
# -----------------------------------------------------------------------------

variable "ecr_repository_name" {
  description = "ECR repository name"
  type        = string
  default     = "tee-rex"
}

# -----------------------------------------------------------------------------
# S3
# -----------------------------------------------------------------------------

variable "prod_s3_bucket" {
  description = "S3 bucket name for production app (legacy, being replaced by mainnet)"
  type        = string
  default     = "tee-rex-app-prod"
}

variable "mainnet_s3_bucket" {
  description = "S3 bucket name for mainnet app"
  type        = string
  default     = "tee-rex-app-mainnet"
}

variable "testnet_s3_bucket" {
  description = "S3 bucket name for testnet app"
  type        = string
  default     = "tee-rex-app-testnet"
}

variable "nightlies_s3_bucket" {
  description = "S3 bucket name for nightlies app"
  type        = string
  default     = "tee-rex-app-nightlies"
}

variable "devnet_s3_bucket" {
  description = "S3 bucket name for devnet app"
  type        = string
  default     = "tee-rex-app-devnet"
}

# -----------------------------------------------------------------------------
# ACM
# -----------------------------------------------------------------------------

variable "acm_certificate_arn" {
  description = "ACM wildcard certificate ARN for *.tee-rex.dev (us-east-1)"
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# CloudFront
# -----------------------------------------------------------------------------

variable "prod_cloudfront_aliases" {
  description = "Alternate domain names for prod CloudFront distribution (legacy)"
  type        = list(string)
  default     = ["nextnet.tee-rex.dev"]
}

variable "mainnet_cloudfront_aliases" {
  description = "Alternate domain names for mainnet CloudFront distribution"
  type        = list(string)
  default     = ["mainnet.tee-rex.dev"]
}

variable "testnet_cloudfront_aliases" {
  description = "Alternate domain names for testnet CloudFront distribution"
  type        = list(string)
  default     = ["testnet.tee-rex.dev"]
}

variable "nightlies_cloudfront_aliases" {
  description = "Alternate domain names for nightlies CloudFront distribution"
  type        = list(string)
  default     = ["nightlies.tee-rex.dev"]
}

variable "devnet_cloudfront_aliases" {
  description = "Alternate domain names for devnet CloudFront distribution"
  type        = list(string)
  default     = ["devnet.tee-rex.dev"]
}
