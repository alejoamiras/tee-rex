provider "aws" {
  region = var.aws_region
}

# CloudFront requires ACM certificates in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# Alibaba Cloud — SGX VMs (g7t instances with Intel SGX)
provider "alicloud" {
  access_key = var.alicloud_access_key
  secret_key = var.alicloud_secret_key
  region     = var.alicloud_region
}
