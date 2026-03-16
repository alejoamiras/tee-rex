# -----------------------------------------------------------------------------
# Instance IDs (for GitHub Secrets reference)
# -----------------------------------------------------------------------------

output "ci_tee_instance_id" {
  description = "CI TEE EC2 instance ID"
  value       = aws_instance.ci_tee.id
  sensitive   = true
}

output "prod_tee_instance_id" {
  description = "Production TEE EC2 instance ID"
  value       = aws_instance.prod_tee.id
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Elastic IPs
# -----------------------------------------------------------------------------

output "prod_tee_eip" {
  description = "Production TEE Elastic IP"
  value       = aws_eip.prod_tee.public_ip
  sensitive   = true
}

# -----------------------------------------------------------------------------
# CloudFront
# -----------------------------------------------------------------------------

output "prod_cloudfront_distribution_id" {
  description = "Production CloudFront distribution ID"
  value       = aws_cloudfront_distribution.prod.id
  sensitive   = true
}

output "prod_cloudfront_domain" {
  description = "Production CloudFront domain name"
  value       = aws_cloudfront_distribution.prod.domain_name
}

output "mainnet_cloudfront_distribution_id" {
  description = "Mainnet CloudFront distribution ID"
  value       = aws_cloudfront_distribution.mainnet.id
  sensitive   = true
}

output "mainnet_cloudfront_domain" {
  description = "Mainnet CloudFront domain name"
  value       = aws_cloudfront_distribution.mainnet.domain_name
}

output "testnet_cloudfront_distribution_id" {
  description = "Testnet CloudFront distribution ID"
  value       = aws_cloudfront_distribution.testnet.id
  sensitive   = true
}

output "testnet_cloudfront_domain" {
  description = "Testnet CloudFront domain name"
  value       = aws_cloudfront_distribution.testnet.domain_name
}

output "nightlies_cloudfront_distribution_id" {
  description = "Nightlies CloudFront distribution ID"
  value       = aws_cloudfront_distribution.nightlies.id
  sensitive   = true
}

output "nightlies_cloudfront_domain" {
  description = "Nightlies CloudFront domain name"
  value       = aws_cloudfront_distribution.nightlies.domain_name
}

# -----------------------------------------------------------------------------
# ECR
# -----------------------------------------------------------------------------

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.tee_rex.repository_url
  sensitive   = true
}

# -----------------------------------------------------------------------------
# IAM
# -----------------------------------------------------------------------------

output "ci_role_arn" {
  description = "CI GitHub Actions role ARN"
  value       = aws_iam_role.ci.arn
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------

output "security_group_id" {
  description = "tee-rex security group ID"
  value       = aws_security_group.tee_rex.id
  sensitive   = true
}
