# Security group: tee-rex-sg
# Conditional SSH + narrow CloudFront rules (port 80 + port 4000) + default egress

resource "aws_security_group" "tee_rex" {
  name        = "tee-rex-sg"
  description = "TEE-Rex Nitro Enclave"
  vpc_id      = data.aws_vpc.default.id
}

# SSH access — disabled by default (ssh_cidr_blocks = [])
# Add your IP to terraform.tfvars when debugging: ssh_cidr_blocks = ["1.2.3.4/32"]
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  count             = length(var.ssh_cidr_blocks) > 0 ? 1 : 0
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.ssh_cidr_blocks[0]
  description       = "SSH"
}

# CloudFront → Prover (port 80)
resource "aws_vpc_security_group_ingress_rule" "cloudfront_prover" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  description       = "CloudFront - Prover (port 80)"
}

# CloudFront → TEE (port 4000)
resource "aws_vpc_security_group_ingress_rule" "cloudfront_tee" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "tcp"
  from_port         = 4000
  to_port           = 4000
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  description       = "CloudFront - TEE (port 4000)"
}

# Default egress (all traffic)
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.tee_rex.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
