# ============================================================================
# main.tf — The entry point. This is where everything comes together.
# ============================================================================

# ============================================================================
# Terraform/OpenTofu settings
# ============================================================================

terraform {
  # Specify which version of OpenTofu this is compatible with
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws" # OpenTofu uses the same providers as Terraform
      version = "~> 5.0"        # ~> means "compatible with 5.x"
    }
  }

  # Where to store state. In practice, use S3 + DynamoDB for team collaboration.
  # For learning, "local" stores it in a file on your machine.
  #
  # backend "s3" {
  #   bucket         = "tee-rex-tofu-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "eu-west-2"
  #   dynamodb_table = "tee-rex-tofu-lock"  # prevents two people applying at once
  #   encrypt        = true
  # }
}

# ============================================================================
# Provider configuration — one per region
#
# This is the magic of OpenTofu 1.9+: for_each on providers.
# Instead of manually writing:
#   provider "aws" { alias = "london"; region = "eu-west-2" }
#   provider "aws" { alias = "sao_paulo"; region = "sa-east-1" }
#
# We loop over our regions map. Add a new region? Just add to the map.
#
# NOTE: for_each on providers requires OpenTofu >= 1.9.
# With Terraform, you'd need to write each provider alias manually.
# ============================================================================

# Default provider (used for global resources like ECR replication, IAM)
provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = {
      Project     = "tee-rex"
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}

# Additional provider for São Paulo
# Each region needs its own provider instance
provider "aws" {
  alias  = "sao_paulo"
  region = "sa-east-1"

  default_tags {
    tags = {
      Project     = "tee-rex"
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}

# ============================================================================
# ECR Cross-Region Replication
#
# This replaces: manually configuring replication in the AWS console.
# One declaration, and OpenTofu ensures it exists.
# ============================================================================

resource "aws_ecr_replication_configuration" "cross_region" {
  replication_configuration {
    rule {
      destination {
        region      = "sa-east-1"
        registry_id = var.aws_account_id
      }

      # Only replicate images tagged with "prod"
      # This avoids replicating CI/dev builds
      repository_filter {
        filter      = "prod"
        filter_type = "PREFIX_MATCH"
      }
    }
  }
}

# ============================================================================
# Module instantiation — one per region
#
# A module is like a function: you define it once (in modules/tee-rex-region/),
# then call it with different arguments.
#
# This is the core pattern for multi-region: same infrastructure definition,
# different region-specific values.
# ============================================================================

module "london" {
  source = "./modules/tee-rex-region"

  # Pass in the provider for this region
  providers = {
    aws = aws # default provider (eu-west-2)
  }

  # Region config from our variables
  region_name     = "london"
  region_config   = var.regions["london"]
  ecr_registry    = "${var.aws_account_id}.dkr.ecr.eu-west-2.amazonaws.com"
  ecr_repository  = var.ecr_repository
  image_tag       = var.image_tag
  key_pair_name   = var.key_pair_name
  environment     = var.environment
}

module "sao_paulo" {
  source = "./modules/tee-rex-region"

  providers = {
    aws = aws.sao_paulo # São Paulo provider
  }

  region_name     = "sao_paulo"
  region_config   = var.regions["sao_paulo"]
  ecr_registry    = "${var.aws_account_id}.dkr.ecr.sa-east-1.amazonaws.com"
  ecr_repository  = var.ecr_repository
  image_tag       = var.image_tag
  key_pair_name   = var.key_pair_name
  environment     = var.environment

  # This module depends on ECR replication being configured first,
  # so the image is available in sa-east-1 before we try to deploy
  depends_on = [aws_ecr_replication_configuration.cross_region]
}

# ============================================================================
# CloudFront — global resource (not per-region)
#
# This is a simplified version of what's in infra/cloudfront/distribution.json.
# In practice, you'd define all the origins, cache behaviors, and the
# geo-routing CloudFront Function here.
#
# Showing the geo-routing function as an example:
# ============================================================================

resource "aws_cloudfront_function" "geo_routing" {
  name    = "tee-rex-geo-routing"
  runtime = "cloudfront-js-2.0"
  publish = true

  # The actual JavaScript function that routes based on viewer location.
  # This runs at every CloudFront edge location, sub-millisecond.
  code = <<-JS
    function handler(event) {
      var request = event.request;
      var country = request.headers['cloudfront-viewer-country']
        ? request.headers['cloudfront-viewer-country'].value
        : '';

      // South American countries → route to São Paulo origins
      var saCountries = ['BR','AR','CL','UY','PY','BO','PE','EC','CO','VE'];

      if (saCountries.includes(country)) {
        // Rewrite /prover/... to /prover-sa/... (hits sa-east-1 cache behavior)
        request.uri = request.uri
          .replace(/^\\/prover\\//, '/prover-sa/')
          .replace(/^\\/tee\\//, '/tee-sa/');
      }

      // Strip prefix for all paths (like current tee-rex-strip-prefix function)
      request.uri = request.uri.replace(/^\\/(prover|tee|prover-sa|tee-sa)/, '') || '/';

      return request;
    }
  JS
}

# In a full implementation, you'd also define:
#
# resource "aws_cloudfront_distribution" "main" {
#   # S3 origin (default)
#   origin { ... }
#
#   # eu-west-2 prover origin
#   origin {
#     domain_name = module.london.prover_elastic_ip
#     origin_id   = "prover-eu"
#     custom_origin_config { ... }
#   }
#
#   # sa-east-1 prover origin
#   origin {
#     domain_name = module.sao_paulo.prover_elastic_ip
#     origin_id   = "prover-sa"
#     custom_origin_config { ... }
#   }
#
#   # Cache behavior: /prover/* → eu-west-2 prover
#   ordered_cache_behavior {
#     path_pattern     = "/prover/*"
#     target_origin_id = "prover-eu"
#     # ... plus the geo-routing function association
#   }
#
#   # Cache behavior: /prover-sa/* → sa-east-1 prover
#   ordered_cache_behavior {
#     path_pattern     = "/prover-sa/*"
#     target_origin_id = "prover-sa"
#   }
#
#   # ... same pattern for /tee/* and /tee-sa/*
# }
