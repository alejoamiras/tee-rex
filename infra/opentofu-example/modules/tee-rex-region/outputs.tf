# ============================================================================
# Module outputs — values that the parent (main.tf) can read.
#
# These flow "upward": module internals → parent → top-level outputs.
# The parent uses these for CloudFront origin config, monitoring, etc.
# ============================================================================

output "prover_elastic_ip" {
  description = "Public IP of the prover (null if not deployed)"
  # The [0] is needed because of `count` — it creates a list, even if only 1 element.
  # try() returns null if the resource doesn't exist (count = 0).
  value = try(aws_eip.prover[0].public_ip, null)
}

output "tee_elastic_ip" {
  description = "Public IP of the TEE instance (null if not deployed)"
  value = try(aws_eip.tee[0].public_ip, null)
}

output "prover_instance_id" {
  description = "EC2 instance ID of the prover (for SSM commands)"
  value = try(aws_instance.prover[0].id, null)
}

output "tee_instance_id" {
  description = "EC2 instance ID of the TEE (for SSM commands)"
  value = try(aws_instance.tee[0].id, null)
}

output "security_group_id" {
  description = "Security group ID (for debugging)"
  value = aws_security_group.tee_rex.id
}
