provider "aws" {
  region = var.aws_region
}

# CloudFront requires ACM certificates in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# Azure — SGX spike (Phase 15E)
provider "azurerm" {
  features {}
  subscription_id = var.azure_subscription_id
}
