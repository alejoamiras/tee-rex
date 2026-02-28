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

output "devnet_tee_instance_id" {
  description = "Devnet TEE EC2 instance ID"
  value       = aws_instance.devnet_tee.id
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

output "devnet_tee_eip" {
  description = "Devnet TEE Elastic IP"
  value       = aws_eip.devnet_tee.public_ip
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

output "devnet_cloudfront_distribution_id" {
  description = "Devnet CloudFront distribution ID"
  value       = aws_cloudfront_distribution.devnet.id
  sensitive   = true
}

output "devnet_cloudfront_domain" {
  description = "Devnet CloudFront domain name"
  value       = aws_cloudfront_distribution.devnet.domain_name
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
