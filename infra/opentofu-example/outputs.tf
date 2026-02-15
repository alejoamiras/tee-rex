# ============================================================================
# Outputs — what gets printed after `tofu apply`.
# Also available to other Terraform/OpenTofu configs that reference this one.
#
# Think of these like return values from a function.
# ============================================================================

output "london_prover_ip" {
  description = "Elastic IP of the London prover"
  value       = module.london.prover_elastic_ip
}

output "london_tee_ip" {
  description = "Elastic IP of the London TEE instance"
  value       = module.london.tee_elastic_ip
}

output "sao_paulo_prover_ip" {
  description = "Elastic IP of the São Paulo prover"
  value       = module.sao_paulo.prover_elastic_ip
}

output "sao_paulo_tee_ip" {
  description = "Elastic IP of the São Paulo TEE instance (null if not deployed)"
  value       = module.sao_paulo.tee_elastic_ip
}

# After `tofu apply`, you'd see something like:
#
# Apply complete! Resources: 8 added, 0 changed, 0 destroyed.
#
# Outputs:
#
# london_prover_ip   = "18.130.xxx.xxx"
# london_tee_ip      = "35.178.xxx.xxx"
# sao_paulo_prover_ip = "54.207.xxx.xxx"
# sao_paulo_tee_ip    = null
