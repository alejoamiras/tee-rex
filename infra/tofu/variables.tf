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
    ci_tee        = string
    ci_prover     = string
    prod_tee      = string
    prod_prover   = string
    devnet_tee    = string
    devnet_prover = string
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
  description = "S3 bucket name for production app"
  type        = string
  default     = "tee-rex-app-prod"
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
  description = "Alternate domain names for prod CloudFront distribution"
  type        = list(string)
  default     = ["nextnet.tee-rex.dev"]
}

variable "devnet_cloudfront_aliases" {
  description = "Alternate domain names for devnet CloudFront distribution"
  type        = list(string)
  default     = ["devnet.tee-rex.dev"]
}

# -----------------------------------------------------------------------------
# Alibaba Cloud — SGX VMs (g7t instances)
# -----------------------------------------------------------------------------

variable "alicloud_access_key" {
  description = "Alibaba Cloud access key ID"
  type        = string
  sensitive   = true
}

variable "alicloud_secret_key" {
  description = "Alibaba Cloud secret access key"
  type        = string
  sensitive   = true
}

variable "alicloud_region" {
  description = "Alibaba Cloud region for SGX VMs"
  type        = string
  default     = "cn-hongkong"
}

variable "alicloud_zone" {
  description = "Alibaba Cloud availability zone (must support g7t instances)"
  type        = string
  default     = "cn-hongkong-b"
}

variable "alicloud_ssh_key_name" {
  description = "ECS key pair name for SGX VM SSH access"
  type        = string
  default     = "tee-rex-sgx-key"
}

variable "alicloud_ssh_public_key" {
  description = "SSH public key material for Alibaba Cloud SGX VMs"
  type        = string
  sensitive   = true
}

variable "alicloud_admin_cidr_blocks" {
  description = "CIDR blocks allowed SSH access to SGX VMs"
  type        = list(string)
  default     = []
}

variable "cloudfront_cidr_blocks" {
  description = "AWS CloudFront IP ranges allowed to reach port 4000 (fetch from https://ip-ranges.amazonaws.com/ip-ranges.json)"
  type        = list(string)
  default     = []
}

