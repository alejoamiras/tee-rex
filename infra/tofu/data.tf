# Account identity — replaces hardcoded account IDs everywhere
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Default VPC (referenced but not managed)
data "aws_vpc" "default" {
  default = true
}

# Default subnets (referenced but not managed)
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# CloudFront managed prefix list — used in security group rules
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# AWS-managed CloudFront cache policies
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# AWS-managed CloudFront origin request policy
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}
