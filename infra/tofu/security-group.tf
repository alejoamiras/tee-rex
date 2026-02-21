# Security group: tee-rex-sg
# 2 ingress rules (SSH + CloudFront port range) + 1 default egress

resource "aws_security_group" "tee_rex" {
  name        = "tee-rex-sg"
  description = "TEE-Rex Nitro Enclave"
  vpc_id      = data.aws_vpc.default.id
}

# SSH access
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.ssh_cidr_blocks[0]
  description       = "SSH"
}

# CloudFront origins: prover (port 80) + TEE (port 4000)
# Single rule covering the range, matching the original SG setup
resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 4000
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  description       = "CloudFront (prover 80 + TEE 4000)"
}

# Default egress (all traffic)
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
