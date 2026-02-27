# -----------------------------------------------------------------------------
# Alibaba Cloud SGX VMs — per-environment (prod, devnet, ci)
#
# Each environment gets: VPC, VSwitch, Security Group, ECS instance, EIP.
# All VMs use ecs.g7t.xlarge (4 vCPU, 16GB RAM, 8GB EPC, Intel Ice Lake SGX).
# Region: cn-hongkong (Zone B — confirmed g7t available).
# -----------------------------------------------------------------------------

locals {
  sgx_environments = toset(["prod", "devnet", "ci"])
  # Each environment uses a distinct /16 to avoid address conflicts
  sgx_vpc_cidrs = {
    prod   = "10.10.0.0/16"
    devnet = "10.11.0.0/16"
    ci     = "10.12.0.0/16"
  }
  sgx_vswitch_cidrs = {
    prod   = "10.10.1.0/24"
    devnet = "10.11.1.0/24"
    ci     = "10.12.1.0/24"
  }
}

# SSH key pair — shared across all SGX environments
resource "alicloud_ecs_key_pair" "sgx" {
  key_pair_name = var.alicloud_ssh_key_name
  public_key    = var.alicloud_ssh_public_key
}

# VPCs — one per environment for isolation
resource "alicloud_vpc" "sgx" {
  for_each   = local.sgx_environments
  vpc_name   = "tee-rex-sgx-${each.key}"
  cidr_block = local.sgx_vpc_cidrs[each.key]
}

# VSwitches — one subnet per environment
resource "alicloud_vswitch" "sgx" {
  for_each     = local.sgx_environments
  vswitch_name = "tee-rex-sgx-${each.key}-vsw"
  vpc_id       = alicloud_vpc.sgx[each.key].id
  cidr_block   = local.sgx_vswitch_cidrs[each.key]
  zone_id      = var.alicloud_zone
}

# Security Groups — hardened: SSH restricted to admin IPs, HTTP:4000 to CloudFront
resource "alicloud_security_group" "sgx" {
  for_each            = local.sgx_environments
  name                = "tee-rex-sgx-${each.key}-sg"
  vpc_id              = alicloud_vpc.sgx[each.key].id
  security_group_type = "normal"
}

# SSH — restricted to admin CIDR blocks
resource "alicloud_security_group_rule" "sgx_ssh" {
  for_each = {
    for pair in setproduct(local.sgx_environments, var.alicloud_admin_cidr_blocks) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], cidr = pair[1] }
  }

  type              = "ingress"
  ip_protocol       = "tcp"
  port_range        = "22/22"
  security_group_id = alicloud_security_group.sgx[each.value.env].id
  cidr_ip           = each.value.cidr
  description       = "SSH from admin"
}

# HTTP:4000 — restricted to CloudFront IP ranges
resource "alicloud_security_group_rule" "sgx_http" {
  for_each = {
    for pair in setproduct(local.sgx_environments, var.cloudfront_cidr_blocks) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], cidr = pair[1] }
  }

  type              = "ingress"
  ip_protocol       = "tcp"
  port_range        = "4000/4000"
  security_group_id = alicloud_security_group.sgx[each.value.env].id
  cidr_ip           = each.value.cidr
  description       = "TEE-Rex server from CloudFront"
}

# ECS instances — ecs.g7t.xlarge: 4 vCPU, 16GB RAM, 8GB EPC
resource "alicloud_instance" "sgx" {
  for_each = local.sgx_environments

  instance_name        = "tee-rex-sgx-${each.key}"
  host_name            = "tee-rex-sgx-${each.key}"
  instance_type        = "ecs.g7t.xlarge"
  security_groups      = [alicloud_security_group.sgx[each.key].id]
  vswitch_id           = alicloud_vswitch.sgx[each.key].id
  key_name             = alicloud_ecs_key_pair.sgx.key_pair_name
  image_id             = data.alicloud_images.ubuntu.images[0].id
  system_disk_category = "cloud_essd"
  system_disk_size     = 64

  internet_max_bandwidth_out = 0 # No direct internet — use EIP

  lifecycle {
    ignore_changes = [image_id]
  }
}

# Look up latest Ubuntu 22.04 image
data "alicloud_images" "ubuntu" {
  owners      = "system"
  name_regex  = "^ubuntu_22_04"
  most_recent = true
}

# Elastic IPs — one per environment
resource "alicloud_eip_address" "sgx" {
  for_each             = local.sgx_environments
  address_name         = "tee-rex-sgx-${each.key}-eip"
  bandwidth            = "100"
  internet_charge_type = "PayByTraffic"
  payment_type         = "PayAsYouGo"
}

# Bind EIPs to instances
resource "alicloud_eip_association" "sgx" {
  for_each      = local.sgx_environments
  allocation_id = alicloud_eip_address.sgx[each.key].id
  instance_id   = alicloud_instance.sgx[each.key].id
  instance_type = "EcsInstance"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "sgx_prod_public_ip" {
  description = "Public IP of the production SGX VM"
  value       = alicloud_eip_address.sgx["prod"].ip_address
}

output "sgx_prod_ssh" {
  description = "SSH command for production SGX VM"
  value       = "ssh ecs-user@${alicloud_eip_address.sgx["prod"].ip_address}"
}

output "sgx_devnet_public_ip" {
  description = "Public IP of the devnet SGX VM"
  value       = alicloud_eip_address.sgx["devnet"].ip_address
}

output "sgx_devnet_ssh" {
  description = "SSH command for devnet SGX VM"
  value       = "ssh ecs-user@${alicloud_eip_address.sgx["devnet"].ip_address}"
}

output "sgx_ci_public_ip" {
  description = "Public IP of the CI SGX VM"
  value       = alicloud_eip_address.sgx["ci"].ip_address
}

output "sgx_ci_ssh" {
  description = "SSH command for CI SGX VM"
  value       = "ssh ecs-user@${alicloud_eip_address.sgx["ci"].ip_address}"
}
