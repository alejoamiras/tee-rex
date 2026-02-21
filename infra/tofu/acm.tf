# Wildcard certificate for *.tee-rex.dev (us-east-1, required by CloudFront)
# Import-only: manually created and validated via Cloudflare DNS.
# lifecycle ignore_changes = all prevents OpenTofu from modifying it.

resource "aws_acm_certificate" "wildcard" {
  provider = aws.us_east_1

  domain_name       = "*.tee-rex.dev"
  validation_method = "DNS"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = all
  }
}
