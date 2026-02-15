# ============================================================================
# Module variables — inputs that the parent (main.tf) passes in.
#
# Each region instantiation provides different values for these.
# The module doesn't know or care which region it's in — it just
# creates whatever resources are defined, using whatever values it receives.
# ============================================================================

variable "region_name" {
  description = "Human-readable region name (london, sao_paulo, etc.)"
  type        = string
}

variable "region_config" {
  description = "Region-specific configuration"
  type = object({
    region          = string
    tee_ami         = string
    prover_ami      = string
    tee_instance    = string
    prover_instance = string
    deploy_tee      = bool
    deploy_prover   = bool
  })
}

variable "ecr_registry" {
  description = "ECR registry URL for this region"
  type        = string
}

variable "ecr_repository" {
  description = "ECR repository name"
  type        = string
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
}

variable "key_pair_name" {
  description = "EC2 key pair name"
  type        = string
}

variable "environment" {
  description = "Environment name (prod, ci)"
  type        = string
}
